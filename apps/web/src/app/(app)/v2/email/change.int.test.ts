import { isRedirectError } from "next/dist/client/components/redirect-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { getCurrentUser, getOwnContacts } from "@/modules/identity";
import type { ActionResult } from "@/platform/action";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../test/factories";
import { freshBrowser, setEnv } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { identityFake } from "../../../../../test/stubs/identity";
import { requestEmailCodeAction, verifyEmailCodeAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

const c = ru.app.profile.emailChange;
const OLD = "old@mail.kz";
const NEW = "new@mail.kz";
const CONTACTS = "/v2/profile/contacts?email=changed";

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  setEnv({ DEMO_MODE: "true", SMS_PROVIDER: "mock" });
  identityFake.now = () => new Date();
});

async function run<T>(p: Promise<ActionResult<T>>): Promise<{ redirect: string } | ActionResult<T>> {
  try {
    return await p;
  } catch (err) {
    if (!isRedirectError(err)) throw err;
    return { redirect: err.digest.split(";")[2] };
  }
}

/** Покупатель, прошедший все первые шаги: почта подтверждена. */
async function verifiedBuyer() {
  const user = await makeClient();
  await db.user.update({ where: { id: user.id }, data: { email: OLD, emailVerifiedAt: new Date() } });
  await signInAs(user);
  return user;
}

async function codeFor(email: string): Promise<string> {
  const res = await run(requestEmailCodeAction({ email, next: "", change: "1" }));
  if (!("ok" in res) || !res.ok || !res.data.demoCode) throw new Error(`код не выслан: ${JSON.stringify(res)}`);
  return res.data.demoCode;
}

describe("смена подтверждённой почты", () => {
  it("запрос кода на новый адрес: код выслан, прежняя почта остаётся подтверждённой и действующей", async () => {
    await verifiedBuyer();
    await codeFor(NEW);
    const user = (await getCurrentUser())!;
    expect(user.emailVerified).toBe(true);
    expect((await getOwnContacts(user)).email).toBe(OLD);
  });

  it("неверный код: ошибка у поля, прежняя почта подтверждена, барьер анкеты не возвращается", async () => {
    await verifiedBuyer();
    const code = await codeFor(NEW);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await run(verifyEmailCodeAction({ code: wrong, email: NEW, next: "", change: "1" }))).toMatchObject({ ok: false, fieldErrors: { code: expect.any(Array) } });
    const user = (await getCurrentUser())!;
    expect(user.emailVerified).toBe(true);
    expect((await getOwnContacts(user)).email).toBe(OLD);
  });

  it("верный код: новый адрес подтверждён, переход в контакты с признаком для тоста", async () => {
    await verifiedBuyer();
    const code = await codeFor(NEW);
    expect(await run(verifyEmailCodeAction({ code, email: NEW, next: "", change: "1" }))).toEqual({ redirect: CONTACTS });
    const user = (await getCurrentUser())!;
    expect(user.emailVerified).toBe(true);
    expect((await getOwnContacts(user)).email).toBe(NEW);
  });

  it("тот же адрес, что уже подтверждён: ошибка у поля, код не выдан", async () => {
    await verifiedBuyer();
    const before = identityFake.calls.filter((x) => x.method === "requestEmailCode").length;
    const res = await run(requestEmailCodeAction({ email: OLD, next: "", change: "1" }));
    expect(res).toMatchObject({ ok: false, fieldErrors: { email: [c.sameAddress] } });
    expect(identityFake.calls.filter((x) => x.method === "requestEmailCode").length).toBe(before + 1);
  });

  it("без признака смены у подтверждённого шаг почты по-прежнему пропускается (переход дальше), код не выдаётся", async () => {
    await verifiedBuyer();
    expect(await run(requestEmailCodeAction({ email: NEW, next: "" }))).toMatchObject({ redirect: expect.any(String) });
    expect(identityFake.calls.filter((x) => x.method === "requestEmailCode")).toHaveLength(0);
    expect(await run(verifyEmailCodeAction({ code: "123456", email: NEW, next: "" }))).toMatchObject({ redirect: expect.any(String) });
  });

  it("гость — UNAUTHENTICATED", async () => {
    expect(await run(requestEmailCodeAction({ email: NEW, next: "", change: "1" }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});
