import { z } from "zod";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db, isUniqueViolation } from "@/platform/db";
import { env } from "@/platform/env";
import type { JobHandler } from "@/platform/jobs";
import { parseInput } from "@/platform/validation";
import { safeLink } from "./links";

/**
 * Web push (решение 2.1.8, ТЗ п. 4.3): каждое in-app уведомление дублируется push на все устройства
 * получателя. Без VAPID-ключей push выключен — in-app работает как раньше.
 */

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
/** Что видит телефон: заголовок события, общий текст без подробностей и ссылка внутрь приложения. */
export type PushMessage = { title: string; body: string; url: string; tag: string };
/** gone — push-сервис ответил 404/410: подписки больше нет (приложение удалено, разрешение отозвано). */
export type PushResult = "sent" | "gone";
export type PushSender = { send(target: PushTarget, message: PushMessage): Promise<PushResult> };

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** VAPID из env: все три ключа или ничего (env.ts проверяет, что не задан только один). */
export function vapidConfig(): VapidConfig | null {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY || !e.VAPID_SUBJECT) return null;
  return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT };
}

/** Публичный ключ для подписки в браузере; null — push выключен, кнопку не показываем. */
export function pushPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null;
}

/** Сутки: уведомление о деньгах старше суток уже не новость — его покажет страница уведомлений. */
const PUSH_TTL_SEC = 24 * 60 * 60;

export function createWebPushSender(config: VapidConfig): PushSender {
  return {
    async send(target, message) {
      // Пакет нужен только при включённом push — грузим по требованию.
      const { default: webPush } = await import("web-push");
      try {
        await webPush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(message), {
          vapidDetails: config,
          TTL: PUSH_TTL_SEC,
          urgency: "normal",
          timeout: 10_000,
        });
        return "sent";
      } catch (e) {
        if (e instanceof webPush.WebPushError && (e.statusCode === 404 || e.statusCode === 410)) return "gone";
        // В ошибку не попадает адрес подписки (в нём токен устройства) — только код ответа.
        throw new Error(e instanceof webPush.WebPushError ? `push-сервис ответил ${e.statusCode}` : "push не отправлен");
      }
    },
  };
}

const defaultSender = (): PushSender | null => {
  const config = vapidConfig();
  return config && createWebPushSender(config);
};

/**
 * Адрес подписки — только у известных push-сервисов браузеров: сервер шлёт POST на этот адрес,
 * и произвольный URL превратил бы подписку в запрос сервера во внутреннюю сеть (SSRF).
 */
const PUSH_HOSTS = new Set(["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

export function isPushServiceUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && url.port === "" && (PUSH_HOSTS.has(url.hostname) || PUSH_HOST_SUFFIXES.some((s) => url.hostname.endsWith(s)));
}

const base64url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+=*$/);

/** Подписка браузера (PushSubscription.toJSON()). */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2000).refine(isPushServiceUrl, ru.notifications.push.errors.badEndpoint),
  keys: z.object({ p256dh: base64url(40, 200), auth: base64url(8, 64) }),
});
export const pushEndpointSchema = z.object({ endpoint: z.string().max(2000) });
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/**
 * Подписать устройство. Адрес подписки принадлежит браузеру: если в нём раньше входил другой
 * человек, подписка переходит к текущему — прежний владелец на этом устройстве push больше не получает.
 */
export async function subscribePush(user: CurrentUser, input: PushSubscriptionInput & { userAgent?: string | null }): Promise<void> {
  const data = { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent?.slice(0, 300) ?? null };
  const save = () => db.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
  // Двойной клик: второй upsert мог не увидеть строку первого и упасть на уникальном адресе — повтор обновит её.
  await save().catch((e: unknown) => (isUniqueViolation(e) ? save() : Promise.reject(e)));
}

/** Отписать своё устройство. Чужую подписку по известному адресу удалить нельзя. */
export async function unsubscribePush(user: CurrentUser, endpoint: string): Promise<void> {
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
}

export const SEND_PUSH = "notifications.sendPush";
export const pushJobKey = (notificationId: string, subscriptionId: string) => `push:${notificationId}:${subscriptionId}`;

const pushPayload = z.object({ notificationId: z.string().min(1), subscriptionId: z.string().min(1) });

/**
 * Задача notifications.sendPush: одна на пару «уведомление × устройство» (dedupeKey), поэтому повтор
 * после сбоя не шлёт push второй раз на другие устройства; tag = id уведомления — телефон заменит
 * повтор, а не покажет два. Подписка, перешедшая к другому человеку, чужое уведомление не получает.
 */
export function createSendPushHandler(sender: () => PushSender | null): JobHandler {
  return async (payload, ctx) => {
    const { notificationId, subscriptionId } = parseInput(pushPayload, payload);
    const push = sender();
    const [notification, subscription] = await Promise.all([
      db.notification.findUnique({ where: { id: notificationId }, select: { userId: true, title: true, link: true } }),
      db.pushSubscription.findUnique({ where: { id: subscriptionId } }),
    ]);
    if (!push || !notification || !subscription || subscription.userId !== notification.userId) {
      ctx.log.info("push.skipped", { notificationId, reason: push ? "stale" : "disabled" });
      return;
    }
    const message: PushMessage = { title: notification.title, body: ru.notifications.push.body, url: safeLink(notification.link), tag: notificationId };
    const result = await push.send(subscription, message);
    if (result === "gone") {
      await db.pushSubscription.deleteMany({ where: { id: subscription.id, endpoint: subscription.endpoint } });
      ctx.log.info("push.subscription_gone", { notificationId });
      return;
    }
    await db.pushSubscription.updateMany({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } });
    ctx.log.info("push.sent", { notificationId });
  };
}

export const sendPushHandler = createSendPushHandler(defaultSender);
