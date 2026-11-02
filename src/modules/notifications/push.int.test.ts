import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/modules/identity";
import { db, transaction } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { runDueJobs } from "@/platform/jobs";
import { makeClient, makeExecutor } from "../../../test/factories";
import { createSendPushHandler, notify, pushJobKey, runQueuedNow, subscribePush, unsubscribePush, type PushMessage, type PushResult } from "./index";

const VAPID = { VAPID_PUBLIC_KEY: "BPublicKeyForTests", VAPID_PRIVATE_KEY: "privateKeyForTests", VAPID_SUBJECT: "mailto:dev@example.com" } as const;
const setVapid = (on: boolean) => {
  for (const [key, value] of Object.entries(VAPID)) {
    if (on) process.env[key] = value;
    else delete process.env[key];
  }
  resetEnvCache();
};
beforeEach(() => setVapid(true));
afterEach(() => setVapid(false));

/** Push-сервис для теста: записывает, что ушло, и отвечает по сценарию. */
function recordingPush(answer: (endpoint: string) => PushResult | Error = () => "sent") {
  const sent: { endpoint: string; message: PushMessage }[] = [];
  const sender = {
    async send(target: { endpoint: string }, message: PushMessage) {
      const result = answer(target.endpoint);
      if (result instanceof Error) throw result;
      sent.push({ endpoint: target.endpoint, message });
      return result;
    },
  };
  return { sent, handlers: { "notifications.sendPush": createSendPushHandler(() => sender) } };
}

let device = 0;
async function subscribe(user: CurrentUser) {
  const endpoint = `https://fcm.googleapis.com/fcm/send/device-${++device}`;
  await subscribePush(user, { endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) }, userAgent: "test" });
  return endpoint;
}

const moneyNotice = (userId: string) => ({ userId, kind: "money.hold.succeeded", title: "Деньги зарезервированы", body: "Сделка №7: покупатель внёс 100 000 ₸.", link: "/deals/d7" });

describe("web push к каждому уведомлению", () => {
  it("каждое устройство получателя получает заголовок, общий текст без сумм и ссылку на сделку", async () => {
    const executor = await makeExecutor();
    const [phone, laptop] = [await subscribe(executor), await subscribe(executor)];
    await subscribe(await makeClient()); // чужое устройство

    await transaction((tx) => notify(tx, moneyNotice(executor.id)));
    const push = recordingPush();
    await runDueJobs(push.handlers);

    expect(push.sent.map((s) => s.endpoint).sort()).toEqual([phone, laptop].sort());
    const notification = await db.notification.findFirstOrThrow({ where: { userId: executor.id } });
    expect(push.sent[0]!.message).toEqual({ title: "Деньги зарезервированы", body: "Откройте, чтобы посмотреть подробности", url: "/deals/d7", tag: notification.id });
    expect(JSON.stringify(push.sent)).not.toMatch(/100 000|Сделка №7/);
  });

  it("откат транзакции события — ни задачи, ни push", async () => {
    const executor = await makeExecutor();
    const endpoint = await subscribe(executor);
    const subscription = await db.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    let notificationId = "";
    await transaction(async (tx) => {
      await notify(tx, moneyNotice(executor.id));
      notificationId = (await tx.notification.findFirstOrThrow({ where: { userId: executor.id } })).id;
      throw new Error("сбой после уведомления");
    }).catch(() => undefined);

    const push = recordingPush();
    await runQueuedNow(push.handlers, [pushJobKey(notificationId, subscription.id)]);
    await runDueJobs(push.handlers);
    expect(push.sent).toEqual([]);
    expect(await db.job.count()).toBe(0);
  });

  it("доставка сразу после коммита — ровно один раз: повтор и проход очереди второй раз не шлют", async () => {
    const client = await makeClient();
    const endpoint = await subscribe(client);
    const subscription = await db.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    await transaction((tx) => notify(tx, moneyNotice(client.id)));
    const notification = await db.notification.findFirstOrThrow({ where: { userId: client.id } });
    const key = pushJobKey(notification.id, subscription.id);

    const push = recordingPush();
    await Promise.all([runQueuedNow(push.handlers, [key]), runQueuedNow(push.handlers, [key])]);
    await runDueJobs(push.handlers);
    expect(push.sent).toHaveLength(1);
    expect(await db.job.findUniqueOrThrow({ where: { dedupeKey: key } })).toMatchObject({ status: "DONE" });
  });

  it("404/410 от push-сервиса — подписка удаляется; сбой сети — задача уходит на повтор", async () => {
    const client = await makeClient();
    const gone = await subscribe(client);
    const flaky = await subscribe(client);
    await transaction((tx) => notify(tx, moneyNotice(client.id)));

    const push = recordingPush((endpoint) => (endpoint === gone ? "gone" : new Error("push-сервис ответил 503")));
    await runDueJobs(push.handlers);
    expect(await db.pushSubscription.findMany({ select: { endpoint: true } })).toEqual([{ endpoint: flaky }]);
    expect(await db.job.findMany({ select: { status: true, lastError: true }, orderBy: { status: "asc" } })).toEqual([
      { status: "PENDING", lastError: "push-сервис ответил 503" },
      { status: "DONE", lastError: null },
    ]);
  });

  it("подписка перешла к другому человеку (вход на том же телефоне) — прежнее уведомление ему не уходит", async () => {
    const first = await makeClient();
    const second = await makeClient();
    const endpoint = await subscribe(first);
    await transaction((tx) => notify(tx, moneyNotice(first.id)));
    await subscribePush(second, { endpoint, keys: { p256dh: "C".repeat(87), auth: "c".repeat(22) } });

    const push = recordingPush();
    await runDueJobs(push.handlers);
    expect(push.sent).toEqual([]);
    expect(await db.pushSubscription.findUniqueOrThrow({ where: { endpoint } })).toMatchObject({ userId: second.id, p256dh: "C".repeat(87) });
  });

  it("без VAPID-ключей push выключен: уведомление in-app есть, задач push нет", async () => {
    setVapid(false);
    const client = await makeClient();
    await subscribe(client);
    await transaction((tx) => notify(tx, moneyNotice(client.id)));
    expect(await db.notification.count({ where: { userId: client.id } })).toBe(1);
    expect(await db.job.count({ where: { kind: "notifications.sendPush" } })).toBe(0);
  });
});

describe("подписка устройства", () => {
  it("повторная подписка того же браузера не создаёт дубль; чужую подписку не отписать (IDOR)", async () => {
    const client = await makeClient();
    const intruder = await makeClient();
    const endpoint = await subscribe(client);
    await subscribePush(client, { endpoint, keys: { p256dh: "D".repeat(87), auth: "d".repeat(22) } });
    expect(await db.pushSubscription.count()).toBe(1);

    await unsubscribePush(intruder, endpoint);
    expect(await db.pushSubscription.count()).toBe(1);
    await unsubscribePush(client, endpoint);
    expect(await db.pushSubscription.count()).toBe(0);
  });
});
