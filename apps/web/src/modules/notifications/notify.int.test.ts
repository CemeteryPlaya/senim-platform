import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { isAppError } from "@/platform/errors";
import { runDueJobs } from "@/platform/jobs";
import { makeClient, makeExecutor } from "../../../test/factories";
import { createSendSmsHandler, notify, notifyTemplate, openNotification, unreadCount, type SmsProvider } from "./index";

function recordingSms() {
  const sent: { phone: string; text: string; idempotencyKey?: string }[] = [];
  const provider: SmsProvider = {
    name: "mock",
    async send(input) {
      sent.push(input);
      return { providerMessageId: `m${sent.length}` };
    },
  };
  return { sent, handlers: { "notifications.sendSms": createSendSmsHandler(() => provider) } };
}

describe("notify с готовым текстом", () => {
  it("важный вид (как у шаблона с SMS) ставит задачу SMS, обычный — нет", async () => {
    const executor = await makeExecutor();
    await db.$transaction(async (tx) => {
      await notify(tx, { userId: executor.id, kind: "deal.ready", title: "Работа сдана", body: "…" });
      await notify(tx, { userId: executor.id, kind: "dispute.resolved", title: "Спор решён", body: "…" });
      await notify(tx, { userId: executor.id, kind: "chat.message", title: "Новое сообщение", body: "…" });
    });
    expect(await db.notification.count()).toBe(3);
    expect(await db.job.count({ where: { kind: "notifications.sendSms" } })).toBe(2);
  });
});

describe("notifyTemplate", () => {
  it("создаёт уведомление по шаблону в транзакции вызывающего", async () => {
    const client = await makeClient();
    await db.$transaction((tx) => notifyTemplate(tx, client.id, "offer.chosen", { requestId: "r1", requestTitle: "Шкаф-купе" }));
    const [n] = await db.notification.findMany({ where: { userId: client.id } });
    expect(n).toMatchObject({ kind: "offer.chosen", title: "Отклик выбран", link: "/requests/r1", readAt: null });
    expect(n!.body).toContain("«Шкаф-купе»");
    expect(await db.job.count()).toBe(0); // без SMS
  });

  it("откат транзакции откатывает и уведомление, и задачу SMS", async () => {
    const executor = await makeExecutor();
    await db
      .$transaction(async (tx) => {
        await notifyTemplate(tx, executor.id, "offer.accepted", { requestId: "r1", requestTitle: "Шкаф" });
        throw new Error("сбой после уведомления");
      })
      .catch(() => undefined);
    expect(await db.notification.count()).toBe(0);
    expect(await db.job.count()).toBe(0);
  });

  it("важное событие ставит одну задачу SMS; задача отправляет ровно одно SMS со ссылкой", async () => {
    const executor = await makeExecutor();
    await db.$transaction((tx) => notifyTemplate(tx, executor.id, "offer.accepted", { requestId: "r7", requestTitle: "Шкаф" }));
    const job = await db.job.findFirstOrThrow();
    expect(job).toMatchObject({ kind: "notifications.sendSms" });

    const { sent, handlers } = recordingSms();
    expect(await runDueJobs(handlers)).toMatchObject({ done: 1 });
    expect(await runDueJobs(handlers)).toMatchObject({ claimed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ phone: executor.phone, idempotencyKey: expect.stringMatching(/^notification:/) });
    expect(sent[0]!.text).toMatch(/^Сенім: Ваш отклик выбран\. http.+\/executor\/requests\/r7$/);
  });

  it("повтор задачи после сбоя передаёт тот же ключ идемпотентности", async () => {
    const executor = await makeExecutor();
    await db.$transaction((tx) => notifyTemplate(tx, executor.id, "offer.accepted", { requestId: "r1", requestTitle: "Шкаф" }));
    const job = await db.job.findFirstOrThrow();
    const { sent, handlers } = recordingSms();
    const handler = handlers["notifications.sendSms"];
    const ctx = { jobId: job.id, attempt: 1, log: (await import("@/platform/logger")).logger };
    await handler(job.payload, ctx);
    await handler(job.payload, { ...ctx, attempt: 2 });
    expect(new Set(sent.map((s) => s.idempotencyKey)).size).toBe(1);
  });

  it("испорченная задача — ошибка проверки (VALIDATION), а не сырой ZodError", async () => {
    const { handlers } = recordingSms();
    const ctx = { jobId: "j", attempt: 1, log: (await import("@/platform/logger")).logger };
    await expect(handlers["notifications.sendSms"]({ notificationId: "" }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("заблокированному пользователю SMS не уходит", async () => {
    const executor = await makeExecutor();
    await db.$transaction((tx) => notifyTemplate(tx, executor.id, "registration.rejected", { reason: "Фото не ваши." }));
    await db.user.update({ where: { id: executor.id }, data: { blockedAt: new Date() } });
    const { sent, handlers } = recordingSms();
    expect(await runDueJobs(handlers)).toMatchObject({ done: 1 });
    expect(sent).toHaveLength(0);
  });

  it("испорченная задача не отправляет SMS и падает (видна в журнале задач)", async () => {
    const { sent, handlers } = recordingSms();
    const handler = handlers["notifications.sendSms"];
    const log = (await import("@/platform/logger")).logger;
    await expect(handler({ nope: 1 }, { jobId: "j", attempt: 1, log })).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});

describe("openNotification", () => {
  it("отмечает своё уведомление прочитанным и отдаёт внутреннюю ссылку", async () => {
    const client = await makeClient();
    await db.$transaction((tx) => notifyTemplate(tx, client.id, "offer.chosen", { requestId: "r1", requestTitle: "Шкаф" }));
    const n = await db.notification.findFirstOrThrow();
    expect(await unreadCount(client.id)).toBe(1);
    expect(await openNotification(client, n.id)).toBe("/requests/r1");
    expect(await unreadCount(client.id)).toBe(0);
    expect(await openNotification(client, n.id)).toBe("/requests/r1"); // повтор безопасен
  });

  it("чужое уведомление — не найдено; внешняя ссылка не используется", async () => {
    const client = await makeClient();
    const other = await makeClient();
    const n = await db.notification.create({ data: { userId: client.id, kind: "x", title: "t", body: "b", link: "https://evil.example" } });
    const e = await openNotification(other, n.id).catch((err: unknown) => err);
    expect(isAppError(e) && e.code).toBe("NOT_FOUND");
    expect(await openNotification(client, n.id)).toBe("/notifications");
    const protocolRelative = await db.notification.create({ data: { userId: client.id, kind: "x", title: "t", body: "b", link: "//evil.example" } });
    expect(await openNotification(client, protocolRelative.id)).toBe("/notifications");
  });
});
