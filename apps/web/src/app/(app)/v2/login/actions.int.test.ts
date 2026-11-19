import { isRedirectError } from "next/dist/client/components/redirect-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testIin } from "@/seed/kz-id";
import { ru } from "@/i18n/ru";
import { Role } from "@/gen/senim/identity/v1/identity_pb";
import { getCurrentUser, sessionCookieName } from "@/modules/identity";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db } from "@/platform/db";
import type { ActionResult } from "@/platform/action";
import { cookieValue, deletedCookies, freshBrowser, setEnv } from "../../../../../test/factories/identity";
import { FAKE_OTP_CODE, identityFake } from "../../../../../test/stubs/identity";
import { recallRole, roleCookieName } from "../../_shell/role-cookie";
import { chooseRoleAction, haveAccountAction, requestCodeAction, verifyCodeAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.login;
const otp = ru.identity.otp.errors;
const PHONE = "+77000006601";
const NEXT = "/v2/deals/1";

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  setEnv({ SMS_PROVIDER: "mock" });
});

/** Итог действия: адрес перехода (redirect) или результат. */
async function run<T>(p: Promise<ActionResult<T>>): Promise<{ redirect: string } | ActionResult<T>> {
  try {
    return await p;
  } catch (e) {
    if (!isRedirectError(e)) throw e;
    return { redirect: e.digest.split(";")[2] };
  }
}

const callsOf = (method: string) => identityFake.calls.filter((c) => c.method === method);
const session = () => cookieValue(sessionCookieName());

/**
 * Человек, уже прошедший первые шаги: согласие (по умолчанию у addUser), ФИО и ИИН, подтверждённая почта — в identity и в
 * проекции (личность проецируется не при входе, а когда её записали, поэтому строка проекции создаётся здесь).
 */
async function existingClient(phone = PHONE) {
  const iin = testIin("870304", 3, 61);
  const person = { fullName: "Сапаров Ерлан", email: "erlan@mail.kz" };
  const user = identityFake.addUser({ phone, person: { ...person, iin, emailVerified: true } });
  await db.user.create({
    data: { id: user.id, phone, role: "CLIENT", roles: ["CLIENT"], ...person, iinLast4: iin.slice(-4), emailVerifiedAt: new Date() },
  });
  return user;
}

/** Известный номер с обеими ролями (активна — заказчика по умолчанию) и одобренным профилем мастера. */
async function clientAndMaster() {
  const iin = testIin("870304", 3, 62);
  const person = { fullName: "Сапаров Ерлан", email: "erlan@mail.kz" };
  const user = identityFake.addUser({ phone: PHONE, defaultRole: Role.CLIENT, roles: [Role.CLIENT, Role.EXECUTOR], person: { ...person, iin, emailVerified: true } });
  await db.user.create({
    data: { id: user.id, phone: PHONE, role: "CLIENT", roles: ["CLIENT", "EXECUTOR"], ...person, iinLast4: iin.slice(-4), emailVerifiedAt: new Date() },
  });
  await db.executorProfile.create({
    data: {
      userId: user.id,
      legalForm: "SELF_EMPLOYED",
      legalName: person.fullName,
      binIinEnc: encryptPii(iin),
      binIinHash: hashPii(iin),
      binIinLast4: last4(iin),
      signerFullName: person.fullName,
      status: "APPROVED",
    },
  });
  return user;
}

describe("chooseRoleAction", () => {
  it("запоминает выбор в подписанной cookie и ведёт на шаг номера с безопасным next", async () => {
    expect(await run(chooseRoleAction({ role: "executor", next: NEXT }))).toEqual({
      redirect: `/v2/login?step=phone&next=${encodeURIComponent(NEXT)}`,
    });
    expect(await recallRole()).toBe("EXECUTOR");
    expect(cookieValue(roleCookieName())).not.toContain("EXECUTOR");
  });

  it("чужой next отбрасывается", async () => {
    expect(await run(chooseRoleAction({ role: "client", next: "https://evil.com/x" }))).toEqual({ redirect: "/v2/login?step=phone" });
    expect(await recallRole()).toBe("CLIENT");
  });

  it("без выбора — ошибка у группы, cookie нет", async () => {
    const res = await run(chooseRoleAction({ next: "" } as never));
    expect(res).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { role: [t.role.errors.required] } });
    expect(cookieValue(roleCookieName())).toBeUndefined();
  });
});

describe("haveAccountAction: «Уже регистрировались? Войти по номеру»", () => {
  it("прежний выбор забыт, дальше шаг номера с безопасным next", async () => {
    await run(chooseRoleAction({ role: "executor", next: "" }));
    expect(await run(haveAccountAction({ next: NEXT }))).toEqual({ redirect: `/v2/login?step=phone&next=${encodeURIComponent(NEXT)}` });
    expect(deletedCookies.map((c) => c.name)).toContain(roleCookieName());
    expect(await recallRole()).toBeNull();
    expect(await run(haveAccountAction({ next: "//evil.com/v2" }))).toEqual({ redirect: "/v2/login?step=phone" });
  });

  it("после «Я мастер» и «Войти по номеру» известный покупатель без профиля мастера попадает в свой дом, а не на анкету", async () => {
    await existingClient();
    await run(chooseRoleAction({ role: "executor", next: "" }));
    await run(haveAccountAction({ next: "" }));
    await run(requestCodeAction({ phone: PHONE }));

    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toEqual({ redirect: "/v2" });
    expect(await recallRole()).toBeNull();
  });
});

describe("requestCodeAction", () => {
  it("номер приводится, код запрошен; код из заглушки identity возвращается для показа", async () => {
    const res = await run(requestCodeAction({ phone: "8 700 000 66 01" }));
    expect(res).toEqual({
      ok: true,
      data: { phone: "+7 700 000 66 01", expiresAt: expect.any(String), shownCode: FAKE_OTP_CODE, alreadySent: false },
    });
    expect(callsOf("requestOtp")[0].request).toMatchObject({ phone: PHONE });
  });

  it("identity не вернул код — null", async () => {
    identityFake.otpProviderMock = false;
    expect(await run(requestCodeAction({ phone: PHONE }))).toMatchObject({ ok: true, data: { shownCode: null } });
  });

  it("неверный номер — ошибка у поля, identity не вызывается", async () => {
    expect(await run(requestCodeAction({ phone: "+7 912 000 00 00" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { phone: [otp.invalidPhone] },
    });
    expect(await run(requestCodeAction({ phone: "  " }))).toMatchObject({ ok: false, fieldErrors: { phone: [t.phone.errors.required] } });
    expect(callsOf("requestOtp")).toHaveLength(0);
  });

  it("слишком часто (перезагрузка на шаге кода) — не ошибка: «код уже отправлен» этому номеру, без кода и срока", async () => {
    identityFake.failNextWithCode("otp_too_often");
    const res = await run(requestCodeAction({ phone: "8 700 000 66 01" }));
    expect(res).toEqual({ ok: true, data: { phone: "+7 700 000 66 01", expiresAt: null, shownCode: null, alreadySent: true } });
  });

  it("после отказа «слишком часто» прежний код действует и впускает", async () => {
    await run(requestCodeAction({ phone: PHONE }));
    identityFake.failNextWithCode("otp_too_often");
    expect(await run(requestCodeAction({ phone: PHONE }))).toMatchObject({ ok: true, data: { alreadySent: true, shownCode: null } });
    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toEqual({ redirect: "/v2/consent" });
  });

  it("прочие лимиты входа — по-прежнему общая ошибка формы", async () => {
    identityFake.failNextWithCode("otp_too_many_requests");
    expect(await run(requestCodeAction({ phone: PHONE }))).toEqual({ ok: false, code: "RATE_LIMITED", error: otp.tooManyRequests });
  });

  it("новый и существующий номер — одинаковый ответ до проверки кода", async () => {
    const fresh = await run(requestCodeAction({ phone: "+77000006602" }));
    await existingClient("+77000006603");
    const known = await run(requestCodeAction({ phone: "+77000006603" }));
    const shape = (r: typeof fresh) => ("ok" in r && r.ok ? Object.keys(r.data).sort() : r);
    expect(shape(known)).toEqual(shape(fresh));
  });
});

describe("verifyCodeAction", () => {
  it("новый номер, выбран «Я мастер»: сессия, переход на согласие, выбор сохранён до конца первых шагов", async () => {
    await run(chooseRoleAction({ role: "executor", next: "" }));
    await run(requestCodeAction({ phone: PHONE }));

    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toEqual({ redirect: "/v2/consent" });
    expect(session()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await recallRole()).toBe("EXECUTOR");
    expect(callsOf("verifyOtp")[0].request).toMatchObject({ phone: PHONE, code: FAKE_OTP_CODE, userAgent: "vitest" });
  });

  it("новый номер с безопасным next: next переносится на согласие; чужой — отбрасывается", async () => {
    await run(requestCodeAction({ phone: PHONE }));
    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: NEXT }))).toEqual({
      redirect: `/v2/consent?next=${encodeURIComponent(NEXT)}`,
    });

    freshBrowser();
    await run(requestCodeAction({ phone: "+77000006604" }));
    expect(await run(verifyCodeAction({ phone: "+77000006604", code: FAKE_OTP_CODE, next: "//evil.com/v2" }))).toEqual({
      redirect: "/v2/consent",
    });
  });

  it("существующий человек, выбрал «Заказать мебель»: свой дом, выбор роли забыт", async () => {
    await existingClient();
    await run(chooseRoleAction({ role: "client", next: "" }));
    await run(requestCodeAction({ phone: PHONE }));

    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toEqual({ redirect: "/v2" });
    expect(session()).toBeDefined();
    expect(deletedCookies.map((c) => c.name)).toContain(roleCookieName());
    expect(await recallRole()).toBeNull();
  });

  it("известный номер без профиля мастера, выбрал «Я мастер»: анкета мастера, выбор живёт дальше, роль та же", async () => {
    await existingClient();
    await run(chooseRoleAction({ role: "executor", next: "" }));
    await run(requestCodeAction({ phone: PHONE }));

    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toEqual({ redirect: "/v2/register/executor" });
    expect(deletedCookies.map((c) => c.name)).not.toContain(roleCookieName());
    expect(await recallRole()).toBe("EXECUTOR");
    expect(callsOf("switchRole")).toHaveLength(0);
    expect((await getCurrentUser())?.role).toBe("CLIENT");
  });

  it("известный номер с ролями заказчика и мастера, активна заказчика, выбрал «Я мастер»: активна мастера, выбор забыт", async () => {
    await clientAndMaster();
    await run(chooseRoleAction({ role: "executor", next: "" }));
    await run(requestCodeAction({ phone: PHONE }));

    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toEqual({ redirect: "/v2" });
    expect(callsOf("switchRole")).toHaveLength(1);
    expect((await getCurrentUser())?.role).toBe("EXECUTOR");
    expect(deletedCookies.map((c) => c.name)).toContain(roleCookieName());
    expect(await recallRole()).toBeNull();
  });

  it("оператор, выбравший «Я мастер»: выбор игнорируется и забывается, дальше второй фактор, как раньше", async () => {
    identityFake.addUser({ phone: PHONE, defaultRole: Role.OPERATOR });
    await run(chooseRoleAction({ role: "executor", next: "" }));
    await run(requestCodeAction({ phone: PHONE }));

    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toEqual({
      redirect: `/v2/operator/mfa?next=${encodeURIComponent("/v2/operator")}`,
    });
    expect(callsOf("switchRole")).toHaveLength(0);
    expect(deletedCookies.map((c) => c.name)).toContain(roleCookieName());
    expect(await recallRole()).toBeNull();
  });

  it("существующий человек с безопасным next — next", async () => {
    await existingClient();
    await run(requestCodeAction({ phone: PHONE }));
    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: NEXT }))).toEqual({ redirect: NEXT });
  });

  it("код с пробелами принимается: «123 456» → 123456", async () => {
    await existingClient();
    await run(requestCodeAction({ phone: PHONE }));
    expect(await run(verifyCodeAction({ phone: PHONE, code: "123 456", next: "" }))).toEqual({ redirect: "/v2" });
  });

  it("неверный код — ошибка у поля с числом попыток, сессии нет", async () => {
    await run(requestCodeAction({ phone: PHONE }));
    expect(await run(verifyCodeAction({ phone: PHONE, code: "000000", next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      error: otp.wrongCode(4),
      fieldErrors: { code: [otp.wrongCode(4)] },
    });
    expect(session()).toBeUndefined();
  });

  it("код не запрашивался — «код устарел» у поля", async () => {
    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toMatchObject({
      ok: false,
      fieldErrors: { code: [otp.expired] },
    });
  });

  it("попытки закончились — общая ошибка формы", async () => {
    await run(requestCodeAction({ phone: PHONE }));
    identityFake.failNextWithCode("otp_attempts_exhausted");
    expect(await run(verifyCodeAction({ phone: PHONE, code: FAKE_OTP_CODE, next: "" }))).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      error: otp.attemptsExhausted,
    });
  });

  it.each(["12345", "1234567", "", "абвгде"])("код «%s» не из 6 цифр — ошибка у поля, identity не вызывается", async (code) => {
    expect(await run(verifyCodeAction({ phone: PHONE, code, next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { code: [t.code.errors.format] },
    });
    expect(callsOf("verifyOtp")).toHaveLength(0);
  });
});
