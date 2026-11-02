import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient } from "../../../../test/factories";

const session = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock("@/modules/identity", async (original) => {
  const { fail } = await import("@/platform/errors");
  return { ...(await original<object>()), requireUser: async () => session.user ?? fail.unauthenticated() };
});

const { DELETE, POST } = await import("./route");

const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/route-device", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
const call = (handler: (r: Request) => Promise<Response>, body: unknown, contentType = "application/json") =>
  handler(new Request("http://localhost/api/push", { method: "POST", headers: { "content-type": contentType, "user-agent": "Test/1.0" }, body: JSON.stringify(body) }));

beforeEach(() => {
  session.user = null;
});

describe("/api/push", () => {
  it("без входа — 401, подписка не сохраняется", async () => {
    expect((await call(POST, subscription)).status).toBe(401);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("подписывает и отписывает своё устройство", async () => {
    session.user = await makeClient();
    expect((await call(POST, subscription)).status).toBe(204);
    expect(await db.pushSubscription.findFirstOrThrow()).toMatchObject({ userId: session.user.id, endpoint: subscription.endpoint, userAgent: "Test/1.0" });
    expect((await call(DELETE, { endpoint: subscription.endpoint })).status).toBe(204);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("не JSON (форма с чужого сайта) и адрес не push-сервиса (SSRF) — 400", async () => {
    session.user = await makeClient();
    expect((await call(POST, subscription, "text/plain")).status).toBe(400);
    const internal = await call(POST, { ...subscription, endpoint: "https://10.0.0.5/admin" });
    expect(internal.status).toBe(400);
    expect(await internal.json()).toMatchObject({ code: "VALIDATION", error: "Неизвестный адрес push-сервиса" });
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("чужое устройство не отписать по известному адресу", async () => {
    const owner = await makeClient();
    session.user = owner;
    await call(POST, subscription);
    session.user = await makeClient();
    expect((await call(DELETE, { endpoint: subscription.endpoint })).status).toBe(204);
    expect(await db.pushSubscription.count()).toBe(1);
  });
});
