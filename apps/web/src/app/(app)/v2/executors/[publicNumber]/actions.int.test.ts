import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../test/factories";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { makeOpenRequest } from "../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../test/factories/session";
import { inviteExecutorAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.guest.executor.invite.errors;
const key = () => crypto.randomUUID();

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
});

async function setup(segment: "ECONOMY" | "COMFORT" = "COMFORT") {
  const client = await makeClient();
  const requestId = await makeOpenRequest(client, { segment });
  const master = await makeExecutor({ segment: "COMFORT" });
  return { client, requestId, master, publicNumber: master.executor.publicNumber };
}

const failure = (r: { ok: boolean; code?: string; error?: string }) => (r.ok ? null : { code: r.code, error: r.error });

describe("inviteExecutorAction", () => {
  it("приглашает: одно приглашение, ответ ok", async () => {
    const { client, requestId, publicNumber } = await setup();
    await signInAs(client);
    const result = await inviteExecutorAction({ requestId, publicNumber, clientKey: key() });
    expect(result).toMatchObject({ ok: true, data: { created: true } });
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(1);
  });

  it("повтор нажатия (тот же ключ и новый ключ): ответ ok, приглашение одно, уведомление одно", async () => {
    const { client, requestId, master, publicNumber } = await setup();
    await signInAs(client);
    const same = key();
    const first = await inviteExecutorAction({ requestId, publicNumber, clientKey: same });
    const second = await inviteExecutorAction({ requestId, publicNumber, clientKey: same });
    const third = await inviteExecutorAction({ requestId, publicNumber, clientKey: key() });
    expect(first).toMatchObject({ ok: true, data: { created: true } });
    // Повтор — тот же успех (экран тот же: «Приглашение отправлено»), только без новой записи.
    expect(second).toMatchObject({ ok: true, data: { created: false } });
    expect(third).toMatchObject({ ok: true, data: { created: false } });
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(1);
    expect(await db.notification.count({ where: { userId: master.id, kind: "request.invited" } })).toBe(1);
  });

  it("другая ценовая группа — отказ с понятным текстом экрана, записи нет", async () => {
    const { client, requestId, publicNumber } = await setup("ECONOMY");
    await signInAs(client);
    expect(failure(await inviteExecutorAction({ requestId, publicNumber }))).toEqual({ code: "VALIDATION", error: t.otherSegment });
    expect(await db.requestInvitation.count()).toBe(0);
  });

  it("чужой заказ, неизвестный мастер, закрытый заказ — отказ с текстом экрана", async () => {
    const { client, requestId, publicNumber } = await setup();
    await signInAs(await makeClient("Нурланов Айдос Ержанович"));
    expect(failure(await inviteExecutorAction({ requestId, publicNumber }))).toEqual({ code: "NOT_FOUND", error: t.notFound });
    await signInAs(client);
    expect(failure(await inviteExecutorAction({ requestId, publicNumber: 999_999 }))).toEqual({ code: "NOT_FOUND", error: t.notFound });
    await db.request.update({ where: { id: requestId }, data: { mode: "DIRECT" } });
    expect(failure(await inviteExecutorAction({ requestId, publicNumber }))).toEqual({ code: "CONFLICT", error: t.closed });
    expect(await db.requestInvitation.count()).toBe(0);
  });

  it("11-й мастер — отказ «не больше 10»", async () => {
    const { client, requestId } = await setup();
    await signInAs(client);
    for (let i = 0; i < 10; i++) {
      const m = await makeExecutor({ segment: "COMFORT" });
      expect((await inviteExecutorAction({ requestId, publicNumber: m.executor.publicNumber })).ok).toBe(true);
    }
    const extra = await makeExecutor({ segment: "COMFORT" });
    expect(failure(await inviteExecutorAction({ requestId, publicNumber: extra.executor.publicNumber }))).toEqual({ code: "CONFLICT", error: t.limit });
  });

  it("лимит 20 вызовов в час на покупателя: 21-й — отказ с текстом", async () => {
    const { client, requestId, publicNumber } = await setup();
    await signInAs(client);
    for (let i = 0; i < 20; i++) expect((await inviteExecutorAction({ requestId, publicNumber })).ok).toBe(true);
    expect(failure(await inviteExecutorAction({ requestId, publicNumber }))).toEqual({ code: "RATE_LIMITED", error: t.rateLimited });
  });

  it("мастер и гость приглашать не могут", async () => {
    const { requestId, publicNumber } = await setup();
    expect((await inviteExecutorAction({ requestId, publicNumber })).ok).toBe(false);
    await signInAs(await makeExecutor({ segment: "COMFORT" }));
    expect((await inviteExecutorAction({ requestId, publicNumber })).ok).toBe(false);
    expect(await db.requestInvitation.count()).toBe(0);
  });

  it("плохой вход — ошибка проверки схемой", async () => {
    const { client, requestId } = await setup();
    await signInAs(client);
    const r = await inviteExecutorAction({ requestId, publicNumber: -1 });
    expect(r.ok ? null : r.code).toBe("VALIDATION");
  });
});
