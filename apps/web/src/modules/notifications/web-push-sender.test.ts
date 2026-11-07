import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ answer: null as null | { statusCode: number }, sent: [] as unknown[][] }));
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      readonly statusCode: number,
      readonly endpoint: string,
    ) {
      super(`Received unexpected response code ${statusCode} for ${endpoint}`);
    }
  }
  const sendNotification = async (...args: unknown[]) => {
    calls.sent.push(args);
    const sub = args[0] as { endpoint: string };
    if (calls.answer) throw new WebPushError(calls.answer.statusCode, sub.endpoint);
    return { statusCode: 201 };
  };
  return { default: { sendNotification, WebPushError } };
});

const { createWebPushSender } = await import("./push");

const config = { publicKey: "pub", privateKey: "priv", subject: "mailto:dev@example.com" };
const target = { endpoint: "https://fcm.googleapis.com/fcm/send/secret-device-token", p256dh: "p", auth: "a" };
const message = { title: "Работа сдана", body: "Откройте, чтобы посмотреть подробности", url: "/deals/d1", tag: "n1" };

beforeEach(() => {
  calls.answer = null;
  calls.sent = [];
});

describe("createWebPushSender", () => {
  it("шлёт JSON уведомления с ключами VAPID, сроком жизни сутки и таймаутом", async () => {
    expect(await createWebPushSender(config).send(target, message)).toBe("sent");
    expect(calls.sent).toEqual([
      [{ endpoint: target.endpoint, keys: { p256dh: "p", auth: "a" } }, JSON.stringify(message), { vapidDetails: config, TTL: 86_400, urgency: "normal", timeout: 10_000 }],
    ]);
  });

  it.each([404, 410])("ответ %i — подписки больше нет", async (statusCode) => {
    calls.answer = { statusCode };
    expect(await createWebPushSender(config).send(target, message)).toBe("gone");
  });

  it("другой отказ — ошибка с кодом ответа, но без адреса подписки (в нём токен устройства)", async () => {
    calls.answer = { statusCode: 503 };
    const error = await createWebPushSender(config)
      .send(target, message)
      .catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("push-сервис ответил 503");
    expect((error as Error).message).not.toContain("secret-device-token");
  });
});
