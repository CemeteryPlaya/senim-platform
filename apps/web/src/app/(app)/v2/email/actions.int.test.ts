import { isRedirectError } from "next/dist/client/components/redirect-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testIin } from "@/demo/kz-id";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { getCurrentUser } from "@/modules/identity";
import type { ActionResult } from "@/platform/action";
import { db } from "@/platform/db";
import { makeOperator } from "../../../../../test/factories";
import { deletedCookies, freshBrowser, setEnv } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { FAKE_OTP_CODE, identityFake } from "../../../../../test/stubs/identity";
import { recallRole, roleCookieName } from "../../_shell/role-cookie";
import { grantConsentAction } from "../consent/actions";
import { chooseRoleAction, requestCodeAction, verifyCodeAction } from "../login/actions";
import { introduceAction } from "../welcome/actions";
import { requestEmailCodeAction, verifyEmailCodeAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.onboarding.email;
const e = ru.app.login.email.errors;
const NEXT = "/v2/deals/1";
const ADDRESS = "erlan@mail.kz";

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

const callsOf = (method: string) => identityFake.calls.filter((c) => c.method === method);

let serial = 0;

/** Тестовый ИИН для номера по порядку: не у всех основ есть контрольная цифра — берётся следующая годная. */
function iinFor(n: number): string {
  for (let i = 100 + n * 7; ; i += 1) {
    try {
      return testIin("870304", 3, i);
    } catch {
      // Для этой основы нет допустимой контрольной цифры.
    }
  }
}

/** Новый номер, согласие, ФИО и ИИН: человек на шаге почты (по желанию — выбравший «Я мастер» на входе). */
async function atEmail(role: "client" | "executor" | null = null) {
  serial += 1;
  const phone = `+7700000${String(8000 + serial).padStart(4, "0")}`;
  if (role) await run(chooseRoleAction({ role, next: "" }));
  await run(requestCodeAction({ phone }));
  await run(verifyCodeAction({ phone, code: FAKE_OTP_CODE, next: "" }));
  await run(grantConsentAction({ agreed: "on", version: CONSENT_DOCUMENTS.PD_PROCESSING.version }));
  await run(introduceAction({ fullName: "Сапаров Ерлан", iin: iinFor(serial), next: "" }));
  const user = (await getCurrentUser())!;
  expect(user.emailVerified).toBe(false);
  return user;
}

/** Запросить код и вернуть его (подделка identity с мок-провайдером писем отдаёт код в ответе). */
async function sentCode(email = ADDRESS): Promise<string> {
  const res = await run(requestEmailCodeAction({ email, next: "" }));
  if (!("ok" in res) || !res.ok || !res.data.demoCode) throw new Error(`код не выслан: ${JSON.stringify(res)}`);
  return res.data.demoCode;
}

const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

describe("requestEmailCodeAction", () => {
  it("код выслан: адрес для строки «Отправили код на …» (без пробелов, строчными) и код заглушки писем", async () => {
    await atEmail();
    const res = await run(requestEmailCodeAction({ email: "  Erlan@Mail.KZ ", next: "" }));
    expect(res).toEqual({ ok: true, data: { email: ADDRESS, demoCode: expect.stringMatching(/^\d{6}$/), alreadySent: false } });
    expect(callsOf("requestEmailCode").at(-1)?.request).toMatchObject({ email: ADDRESS });
  });

  it("пустой адрес — ошибка у поля, identity не вызывается", async () => {
    await atEmail();
    expect(await run(requestEmailCodeAction({ email: "  ", next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { email: [t.errors.required] },
    });
    expect(callsOf("requestEmailCode")).toHaveLength(0);
  });

  it("неверный адрес — ошибка у поля, identity не вызывается", async () => {
    await atEmail();
    expect(await run(requestEmailCodeAction({ email: "erlan@", next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { email: [e.invalid] },
    });
    expect(callsOf("requestEmailCode")).toHaveLength(0);
  });

  it("второй запрос в ту же минуту (перезагрузка на шаге кода) — не ошибка: «код уже отправлен», прежний код действует", async () => {
    await atEmail();
    const code = await sentCode();
    const res = await run(requestEmailCodeAction({ email: ` ${ADDRESS.toUpperCase()}`, next: "" }));
    expect(res).toEqual({ ok: true, data: { email: ADDRESS, demoCode: null, alreadySent: true } });
    // Второго кода нет: identity отказал, прежний код подтверждает почту.
    expect(await run(verifyEmailCodeAction({ code, email: ADDRESS, next: NEXT }))).toEqual({ redirect: NEXT });
  });

  it("в ту же минуту на другой адрес — ошибка у поля адреса «код отправлен на другой адрес», шага кода нет", async () => {
    await atEmail();
    await sentCode();
    expect(await run(requestEmailCodeAction({ email: "other@mail.kz", next: "" }))).toMatchObject({
      ok: false,
      code: "RATE_LIMITED",
      error: t.errors.otherAddress,
      fieldErrors: { email: [t.errors.otherAddress] },
    });
  });

  it("лимит в час — текст из ru", async () => {
    await atEmail();
    let now = Date.now();
    identityFake.now = () => new Date(now);
    for (let i = 0; i < 5; i += 1) {
      await sentCode();
      now += 61_000;
    }
    expect(await run(requestEmailCodeAction({ email: ADDRESS, next: "" }))).toMatchObject({ ok: false, code: "RATE_LIMITED", error: e.tooMany });
  });

  it("почта уже подтверждена в identity (отставшая проекция, другая вкладка) — не ошибка: дальше по nextStepFor", async () => {
    const user = await atEmail();
    const code = await sentCode();
    await run(verifyEmailCodeAction({ code, email: ADDRESS, next: "" }));
    // Проекция отстала: web снова считает почту неподтверждённой, identity — подтверждённой.
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    identityFake.now = () => new Date(Date.now() + 61_000);

    expect(await run(requestEmailCodeAction({ email: ADDRESS, next: NEXT }))).toEqual({ redirect: NEXT });
    expect((await getCurrentUser())?.emailVerified).toBe(true);
  });

  it("почта уже подтверждена в web (вторая вкладка) — дальше без обращения к identity", async () => {
    await atEmail();
    await run(verifyEmailCodeAction({ code: await sentCode(), email: ADDRESS, next: "" }));
    const before = callsOf("requestEmailCode").length;
    expect(await run(requestEmailCodeAction({ email: "other@mail.kz", next: NEXT }))).toEqual({ redirect: NEXT });
    expect(callsOf("requestEmailCode")).toHaveLength(before);
  });
});

describe("verifyEmailCodeAction", () => {
  it("верный код: почта подтверждена в проекции, выбор роли забыт, переход на next", async () => {
    const user = await atEmail();
    const code = await sentCode();
    expect(await run(verifyEmailCodeAction({ code: `${code.slice(0, 3)} ${code.slice(3)}`, email: ADDRESS, next: NEXT }))).toEqual({ redirect: NEXT });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    expect(identityFake.personOf(user.id)).toMatchObject({ email: ADDRESS, emailVerified: true });
    expect(deletedCookies.map((c) => c.name)).toContain(roleCookieName());
  });

  it("без next — дом покупателя; чужой next отбрасывается", async () => {
    await atEmail();
    expect(await run(verifyEmailCodeAction({ code: await sentCode(), email: ADDRESS, next: "https://evil.example/x" }))).toEqual({ redirect: "/v2" });
  });

  it("выбравший «Я мастер» на входе — на регистрацию мастера; выбор забыт", async () => {
    await atEmail("executor");
    expect(await recallRole()).toBe("EXECUTOR");
    expect(await run(verifyEmailCodeAction({ code: await sentCode(), email: ADDRESS, next: "" }))).toEqual({ redirect: "/v2/register/executor" });
    expect(await recallRole()).toBeNull();
  });

  it("неверный код — у поля, с числом оставшихся попыток", async () => {
    await atEmail();
    const code = await sentCode();
    expect(await run(verifyEmailCodeAction({ code: wrong(code), email: ADDRESS, next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { code: [e.wrongCode(4)] },
    });
  });

  it("код истёк — у поля «Код устарел»", async () => {
    await atEmail();
    const code = await sentCode();
    identityFake.now = () => new Date(Date.now() + 11 * 60_000);
    expect(await run(verifyEmailCodeAction({ code, email: ADDRESS, next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { code: [e.expired] },
    });
  });

  it("подтверждается ровно показанный адрес: код выдан на другой — «код устарел» у поля, почта не подтверждена", async () => {
    const user = await atEmail();
    const code = await sentCode();
    expect(await run(verifyEmailCodeAction({ code, email: "other@mail.kz", next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { code: [e.expired] },
    });
    expect(identityFake.personOf(user.id)).toMatchObject({ emailVerified: false });
    // Попытка не потрачена: верный адрес с тем же кодом подтверждает.
    expect(await run(verifyEmailCodeAction({ code, email: ADDRESS, next: NEXT }))).toEqual({ redirect: NEXT });
  });

  it("не 6 цифр — ошибка у поля без обращения к identity (попытка не тратится)", async () => {
    await atEmail();
    await sentCode();
    expect(await run(verifyEmailCodeAction({ code: "12 3", email: ADDRESS, next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { code: [e.codeFormat] },
    });
    expect(callsOf("verifyEmailCode")).toHaveLength(0);
  });

  it("повтор того же кода из второй вкладки — не ошибка: дальше по nextStepFor", async () => {
    await atEmail();
    const code = await sentCode();
    expect(await run(verifyEmailCodeAction({ code, email: ADDRESS, next: NEXT }))).toEqual({ redirect: NEXT });
    expect(await run(verifyEmailCodeAction({ code, email: ADDRESS, next: NEXT }))).toEqual({ redirect: NEXT });
  });
});

describe("кто может", () => {
  it("гость — UNAUTHENTICATED", async () => {
    expect(await run(requestEmailCodeAction({ email: ADDRESS, next: "" }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await run(verifyEmailCodeAction({ code: "123456", email: ADDRESS, next: "" }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("оператор — FORBIDDEN, identity не вызывается (шага почты у сотрудников нет)", async () => {
    await signInAs(await makeOperator());
    expect(await run(requestEmailCodeAction({ email: ADDRESS, next: "" }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(callsOf("requestEmailCode")).toHaveLength(0);
  });
});
