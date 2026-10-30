import "server-only";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db, type Db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { enqueueJob, type JobHandler } from "@/platform/jobs";
import { createHttpSmsProvider, mockSmsProvider, type SmsProvider } from "./sms";
import { renderTemplate, TEMPLATES, type TemplateKey, type TemplateParams } from "./templates";

export type { SmsProvider } from "./sms";
export { renderTemplate, TEMPLATES, type TemplateKey, type TemplateParams } from "./templates";

export type NotifyInput = {
  userId: string;
  kind: string; // ключ шаблона, например «offer.received»
  title: string;
  body: string;
  link?: string;
};

const SEND_SMS = "notifications.sendSms";
const TEMPLATES_WITH_SMS = new Set<string>(Object.entries(TEMPLATES).flatMap(([key, t]) => (t.sms ? [key] : [])));
/** Виды, под которыми модули пишут те же события, что и шаблоны. */
const KIND_ALIASES: Record<string, TemplateKey> = { "deal.dispute.resolved": "dispute.resolved" };

function needsSms(kind: string): boolean {
  return TEMPLATES_WITH_SMS.has(KIND_ALIASES[kind] ?? kind);
}

/**
 * In-app уведомление с готовым текстом. Вызывать в той же транзакции, что и изменение состояния.
 * Если вид совпадает с важным шаблоном (sms: true), ставит и задачу SMS — как notifyTemplate.
 */
export async function notify(tx: Db, input: NotifyInput): Promise<void> {
  const notification = await tx.notification.create({ data: input, select: { id: true } });
  if (needsSms(input.kind)) {
    await enqueueJob(tx, { kind: SEND_SMS, payload: { notificationId: notification.id }, dedupeKey: `sms:${notification.id}` });
  }
}

/**
 * Уведомление по шаблону (templates.ts). Вызывать в транзакции изменения состояния:
 * откат убирает и уведомление, и задачу SMS. Для важных событий (sms: true) ставит
 * задачу notifications.sendSms — одна задача на уведомление (dedupeKey).
 */
export async function notifyTemplate<K extends TemplateKey>(tx: Db, userId: string, key: K, params: TemplateParams<K>): Promise<void> {
  const { title, body, link } = renderTemplate(key, params);
  const notification = await tx.notification.create({ data: { userId, kind: key, title, body, link }, select: { id: true } });
  if (needsSms(key)) {
    await enqueueJob(tx, { kind: SEND_SMS, payload: { notificationId: notification.id }, dedupeKey: `sms:${notification.id}` });
  }
}

export async function listNotifications(userId: string, limit = 30) {
  return db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function unreadCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string) {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

/** Только внутренние пути: «/deals/…». Внешние и «//host» — на страницу уведомлений (без открытого редиректа). */
function safeLink(link: string | null): string {
  return link && link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\") ? link : "/notifications";
}

/** Открыть своё уведомление: отметить прочитанным (повтор безопасен) и вернуть, куда перейти. */
export async function openNotification(user: CurrentUser, notificationId: string): Promise<string> {
  const notification = await db.notification.findFirst({ where: { id: notificationId, userId: user.id } });
  if (!notification) return fail.notFound();
  if (!notification.readAt) await db.notification.updateMany({ where: { id: notification.id, readAt: null }, data: { readAt: new Date() } });
  return safeLink(notification.link);
}

export function smsProvider(): SmsProvider {
  const e = env();
  switch (e.SMS_PROVIDER) {
    case "mock":
      return mockSmsProvider;
    case "http":
      // env.ts требует SMS_HTTP_URL и SMS_HTTP_TOKEN при SMS_PROVIDER=http.
      if (!e.SMS_HTTP_URL || !e.SMS_HTTP_TOKEN) return fail.unavailable("SMS-шлюз не настроен");
      return createHttpSmsProvider({ url: e.SMS_HTTP_URL, token: e.SMS_HTTP_TOKEN, sender: e.SMS_SENDER });
  }
}

const smsPayload = z.object({ notificationId: z.string().min(1) });

/**
 * Задача notifications.sendSms. Идемпотентна: одна задача на уведомление (dedupeKey при постановке),
 * а при повторе после сбоя шлюз получает тот же Idempotency-Key «notification:<id>».
 */
export function createSendSmsHandler(provider: () => SmsProvider): JobHandler {
  return async (payload, ctx) => {
    const { notificationId } = smsPayload.parse(payload);
    const notification = await db.notification.findUnique({
      where: { id: notificationId },
      select: { title: true, link: true, user: { select: { phone: true, blockedAt: true } } },
    });
    if (!notification || notification.user.blockedAt) {
      ctx.log.info("sms.skipped", { notificationId, reason: notification ? "blocked" : "missing" });
      return;
    }
    const url = notification.link ? new URL(safeLink(notification.link), env().APP_URL).toString() : null;
    const result = await provider().send({
      phone: notification.user.phone,
      text: ru.notifications.sms(notification.title, url),
      idempotencyKey: `notification:${notificationId}`,
    });
    ctx.log.info("sms.sent", { notificationId, providerMessageId: result.providerMessageId });
  };
}

export const jobHandlers = {
  [SEND_SMS]: createSendSmsHandler(smsProvider),
} as const;
