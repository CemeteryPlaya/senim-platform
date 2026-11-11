import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { AppError } from "@/platform/errors";
import { totpNow } from "../../../e2e/totp";
import { freshBrowser, setEnv } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { makeClient, makeOperator } from "../../../test/factories";
import { identityFake } from "../../../test/stubs/identity";
import { confirmTotpEnrollment, requireRecentMfa, startTotpEnrollment, verifySecondFactor } from "./mfa";
import { mfaHref } from "./return-to";
import { getCurrentUser, requireUser, type CurrentUser } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

const t = ru.identity.mfa;

beforeEach(() => freshBrowser());
afterEach(() => setEnv({ MFA_STEP_UP_WINDOW: undefined, DEMO_MODE: undefined }));

async function errorOf(p: Promise<unknown> | (() => unknown)): Promise<AppError> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("ошибки не было");
}

/** Оператор, вошедший только по SMS: второй ступени в сессии нет. */
async function smsOperator(): Promise<CurrentUser> {
  const op = await makeOperator();
  await signInAs(op, undefined, { mfaVerifiedAt: null });
  const user = await getCurrentUser();
  if (!user) throw new Error("нет пользователя");
  return user;
}

describe("второй фактор оператора: подключение и проверка через identity", () => {
  it("сессия оператора по SMS: второй фактор нужен и не пройден; у заказчика — не нужен", async () => {
    const op = await smsOperator();
    expect(op.mfa).toEqual({ required: true, verifiedAt: null });

    freshBrowser();
    const client = await makeClient();
    await signInAs(client);
    expect((await getCurrentUser())?.mfa).toEqual({ required: false, verifiedAt: null });
  });

  it("подключение: секрет base32, otpauth-URI с брендом и телефоном, QR в SVG; подтверждение кодом ставит отметку", async () => {
    const op = await smsOperator();
    const enrollment = await startTotpEnrollment(op);
    if (!enrollment) throw new Error("подключение не начато");
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);
    const label = `${encodeURIComponent(brand.name)}:${encodeURIComponent(op.phone)}`;
    expect(enrollment.otpauthUrl).toBe(`otpauth://totp/${label}?secret=${enrollment.secret}&issuer=${encodeURIComponent(brand.name)}&digits=6&period=30`);
    expect(enrollment.qrSvg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);

    await confirmTotpEnrollment(op, totpNow(enrollment.secret));
    const after = await getCurrentUser();
    expect(after?.mfa.verifiedAt).toBeInstanceOf(Date);
    expect(identityFake.factorState(op.id)).toBe("confirmed");
  });

  it("уже подключено — startTotpEnrollment даёт null (экран спросит код)", async () => {
    const op = await smsOperator();
    identityFake.enrollTotp(op.id);
    expect(await startTotpEnrollment(op)).toBeNull();
  });

  it("неверный код — текст с числом попыток; повтор кода — свой текст; верный код ставит отметку", async () => {
    const op = await smsOperator();
    const secret = identityFake.enrollTotp(op.id);
    const code = totpNow(secret);
    const wrong = code === "000000" ? "111111" : "000000";

    const e = await errorOf(verifySecondFactor(op, wrong));
    expect(e.code).toBe("VALIDATION");
    expect(e.message).toBe(t.errors.wrongCode(4));

    await verifySecondFactor(op, code);
    expect((await getCurrentUser())?.mfa.verifiedAt).toBeInstanceOf(Date);

    const reused = await errorOf(verifySecondFactor(op, code));
    expect(reused.message).toBe(t.errors.reused);
  });

  it("код с пробелами внутри принимается («123 456» из приложения)", async () => {
    const op = await smsOperator();
    const secret = identityFake.enrollTotp(op.id);
    const code = totpNow(secret);
    await verifySecondFactor(op, ` ${code.slice(0, 3)} ${code.slice(3)} `);
    expect((await getCurrentUser())?.mfa.verifiedAt).toBeInstanceOf(Date);
  });

  it("не шесть цифр — VALIDATION без вызова identity", async () => {
    const op = await smsOperator();
    identityFake.calls.length = 0;
    expect((await errorOf(verifySecondFactor(op, "12345"))).message).toBe(t.errors.format);
    expect((await errorOf(confirmTotpEnrollment(op, "abcdef"))).message).toBe(t.errors.format);
    expect(identityFake.calls.filter((c) => c.method !== "authenticate")).toHaveLength(0);
  });

  it("requireUser: оператор без второй ступени — MFA_REQUIRED; после проверки — пускает", async () => {
    const op = await smsOperator();
    expect((await errorOf(requireUser("OPERATOR"))).code).toBe("MFA_REQUIRED");
    const secret = identityFake.enrollTotp(op.id);
    await verifySecondFactor(op, totpNow(secret));
    await expect(requireUser("OPERATOR")).resolves.toMatchObject({ id: op.id });
  });

  it("адрес экрана второго фактора — с возвратом на страницу", () => {
    expect(mfaHref("/operator/money")).toBe("/operator/mfa?next=%2Foperator%2Fmoney");
    expect(mfaHref("//evil.example")).toBe("/operator/mfa");
  });
});

describe("requireRecentMfa: свежий код перед действием с деньгами", () => {
  const at = new Date("2026-11-11T10:00:00Z");
  const operator = (verifiedAt: Date | null, isDemo = false): CurrentUser => ({
    id: "u1",
    role: "OPERATOR",
    roles: ["OPERATOR"],
    phone: "+77000000001",
    fullName: null,
    iinLast4: null,
    isDemo,
    executor: null,
    mfa: { required: true, verifiedAt },
    consents: [],
  });
  const plus = (ms: number) => new Date(at.getTime() + ms);

  it("ровно 5 минут — проходит, на секунду больше — MFA_REQUIRED с текстом из ru", async () => {
    expect(() => requireRecentMfa(operator(at), plus(5 * 60_000))).not.toThrow();
    const e = await errorOf(() => requireRecentMfa(operator(at), plus(5 * 60_000 + 1000)));
    expect(e.code).toBe("MFA_REQUIRED");
    expect(e.message).toBe(t.stepUp);
  });

  it("вторая ступень не пройдена — MFA_REQUIRED", async () => {
    expect((await errorOf(() => requireRecentMfa(operator(null), at))).code).toBe("MFA_REQUIRED");
  });

  it("окно задаёт MFA_STEP_UP_WINDOW", async () => {
    setEnv({ MFA_STEP_UP_WINDOW: "1m" });
    expect(() => requireRecentMfa(operator(at), plus(60_000))).not.toThrow();
    expect((await errorOf(() => requireRecentMfa(operator(at), plus(61_000)))).code).toBe("MFA_REQUIRED");
  });

  it("демо-оператор при DEMO_MODE=true не спрашивается (у демо-персон нет приложения); без DEMO_MODE — спрашивается", async () => {
    setEnv({ DEMO_MODE: "true" });
    expect(() => requireRecentMfa(operator(at, true), plus(60 * 60_000))).not.toThrow();
    setEnv({ DEMO_MODE: "false" });
    expect((await errorOf(() => requireRecentMfa(operator(at, true), plus(60 * 60_000)))).code).toBe("MFA_REQUIRED");
  });
});
