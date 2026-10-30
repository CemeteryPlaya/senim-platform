import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeExecutor } from "../../../test/factories";
import { cookieValue, freshBrowser, setEnv } from "../../../test/factories/identity";
import { requestOtp, verifyOtp } from "./otp";
import { getCurrentUser, SESSION_COOKIE } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

const PHONE = "+77000005501";
const IP = "203.0.113.7";

beforeEach(() => {
  freshBrowser();
  setEnv({ DEMO_MODE: "true", SMS_PROVIDER: "mock", OTP_DAILY_GLOBAL_LIMIT: undefined });
});

async function codeFor(phone = PHONE, ip = IP): Promise<string> {
  const { demoCode } = await requestOtp({ phone, ip });
  if (!demoCode) throw new Error("в демо-режиме код возвращается");
  return demoCode;
}

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e;
}

describe("requestOtp", () => {
  it("хранит только HMAC шестизначного кода со сроком 5 минут", async () => {
    const before = Date.now();
    const code = await codeFor("8 700 000 55 01");

    expect(code).toMatch(/^\d{6}$/);
    const row = await db.otpCode.findFirstOrThrow({ where: { phone: PHONE } });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(code);
    const ttl = row.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(4.9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000 + 1000);
  });

  it("вне демо-режима код не возвращает", async () => {
    setEnv({ DEMO_MODE: "false" });
    expect((await requestOtp({ phone: PHONE, ip: IP })).demoCode).toBeNull();
  });

  it("отклоняет не казахстанский мобильный номер", async () => {
    expect((await errorOf(requestOtp({ phone: "+7 912 000 00 00", ip: IP }))).code).toBe("VALIDATION");
  });

  it("не даёт запросить код повторно раньше чем через минуту", async () => {
    await codeFor();
    expect((await errorOf(requestOtp({ phone: PHONE, ip: IP }))).code).toBe("RATE_LIMITED");
  });

  it("ограничивает число запросов с одного IP", async () => {
    for (let i = 0; i < 20; i++) await requestOtp({ phone: `+770000060${String(i).padStart(2, "0")}`, ip: IP });
    expect((await errorOf(requestOtp({ phone: "+77000006099", ip: IP }))).code).toBe("RATE_LIMITED");
    await expect(requestOtp({ phone: "+77000006099", ip: "198.51.100.1" })).resolves.toBeTruthy();
  });

  it("неизвестный IP не даёт общего лимита на всех: работают лимиты по номеру", async () => {
    for (let i = 0; i < 25; i++) await requestOtp({ phone: `+770000070${String(i).padStart(2, "0")}`, ip: null });
    expect(await db.rateLimitBucket.count({ where: { key: { contains: "ip" } } })).toBe(0);
    expect((await errorOf(requestOtp({ phone: "+77000007000", ip: null }))).code).toBe("RATE_LIMITED");
  });

  it("не больше 10 кодов в сутки на номер", async () => {
    for (let i = 0; i < 10; i++) {
      await requestOtp({ phone: PHONE, ip: null });
      // Часовые окна и минутная пауза истекли — остаётся только суточное.
      await db.rateLimitBucket.deleteMany({ where: { NOT: { key: { endsWith: ":day" } } } });
    }
    const e = await errorOf(requestOtp({ phone: PHONE, ip: null }));
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.message).toMatch(/сутки/);
  });

  it("общий суточный лимит кодов (OTP_DAILY_GLOBAL_LIMIT): рассылка по разным номерам с разных IP упирается в него", async () => {
    setEnv({ OTP_DAILY_GLOBAL_LIMIT: "3" });
    for (let i = 0; i < 3; i++) await requestOtp({ phone: `+770000080${i}0`, ip: `198.51.100.${i}` });

    const e = await errorOf(requestOtp({ phone: "+77000008099", ip: "198.51.100.99" }));
    expect(e.code).toBe("RATE_LIMITED");
    expect(await db.otpCode.count()).toBe(3);
  });

  it("общий лимит по умолчанию — 500 кодов в сутки", async () => {
    const { env } = await import("@/platform/env");
    expect(env().OTP_DAILY_GLOBAL_LIMIT).toBe(500);
  });

  it("отказ по лимиту номера не расходует общий суточный лимит", async () => {
    setEnv({ OTP_DAILY_GLOBAL_LIMIT: "2" });
    await requestOtp({ phone: PHONE, ip: null });
    for (let i = 0; i < 5; i++) await errorOf(requestOtp({ phone: PHONE, ip: null }));
    await expect(requestOtp({ phone: "+77000008101", ip: null })).resolves.toBeTruthy();
  });

  it("действует только последний выданный код", async () => {
    const first = await codeFor();
    await db.rateLimitBucket.deleteMany();
    const second = await codeFor();

    expect((await errorOf(verifyOtp({ phone: PHONE, code: first, ip: IP }))).code).toBe("VALIDATION");
    await expect(verifyOtp({ phone: PHONE, code: second, ip: IP })).resolves.toMatchObject({ isNew: true });
  });
});

describe("verifyOtp", () => {
  it("верный код: новый телефон становится заказчиком, ставится сессия", async () => {
    const code = await codeFor();

    const result = await verifyOtp({ phone: "+7 700 000 55 01", code, ip: IP, userAgent: "vitest" });

    expect(result).toMatchObject({ isNew: true, role: "CLIENT" });
    expect(cookieValue(SESSION_COOKIE)).toBeTruthy();
    expect(await getCurrentUser()).toMatchObject({ id: result.userId, phone: PHONE, role: "CLIENT" });
    expect(await db.auditEvent.count({ where: { action: "user.registered", entityId: result.userId } })).toBe(1);
  });

  it("существующий пользователь входит со своей ролью", async () => {
    const operator = await db.user.create({ data: { phone: PHONE, role: "OPERATOR" } });
    const code = await codeFor();

    expect(await verifyOtp({ phone: PHONE, code, ip: IP })).toMatchObject({ userId: operator.id, role: "OPERATOR", isNew: false });
  });

  it("исполнителю возвращает статус профиля — для выбора экрана после входа", async () => {
    const ex = await makeExecutor({ status: "PENDING" });
    const code = await codeFor(ex.phone);

    expect(await verifyOtp({ phone: ex.phone, code, ip: IP })).toMatchObject({ role: "EXECUTOR", executor: { status: "PENDING" } });
  });

  it("неверный код: ошибка с числом оставшихся попыток, сессии нет", async () => {
    const code = await codeFor();
    const wrong = code === "000000" ? "111111" : "000000";

    const e = await errorOf(verifyOtp({ phone: PHONE, code: wrong, ip: IP }));

    expect(e.code).toBe("VALIDATION");
    expect(e.message).toMatch(/4/);
    expect(cookieValue(SESSION_COOKIE)).toBeUndefined();
  });

  it("после 5 неверных попыток не принимает даже верный код", async () => {
    const code = await codeFor();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await errorOf(verifyOtp({ phone: PHONE, code: wrong, ip: IP }));

    expect((await errorOf(verifyOtp({ phone: PHONE, code, ip: IP }))).code).toBe("RATE_LIMITED");
    expect(await db.user.count()).toBe(0);
  });

  it("не больше 20 проверок кода в сутки на номер — с любых IP", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await errorOf(verifyOtp({ phone: PHONE, code: "000000", ip: `198.51.100.${i}` }))).code).toBe("VALIDATION");
    }
    const e = await errorOf(verifyOtp({ phone: PHONE, code: "000000", ip: "203.0.113.200" }));
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.message).toMatch(/сутки/);
  });

  it("истёкший код не принимается", async () => {
    const code = await codeFor();
    await db.otpCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await errorOf(verifyOtp({ phone: PHONE, code, ip: IP }))).code).toBe("VALIDATION");
  });

  it("код одноразовый: повтор отклоняется", async () => {
    const code = await codeFor();
    await verifyOtp({ phone: PHONE, code, ip: IP });

    expect((await errorOf(verifyOtp({ phone: PHONE, code, ip: IP }))).code).toBe("VALIDATION");
  });

  it("два одновременных ввода одного кода дают ровно один вход", async () => {
    const code = await codeFor();

    const results = await Promise.allSettled([verifyOtp({ phone: PHONE, code, ip: IP }), verifyOtp({ phone: PHONE, code, ip: IP })]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.session.count()).toBe(1);
  });

  it("заблокированный пользователь не входит", async () => {
    await db.user.create({ data: { phone: PHONE, role: "CLIENT", blockedAt: new Date() } });
    const code = await codeFor();

    expect((await errorOf(verifyOtp({ phone: PHONE, code, ip: IP }))).code).toBe("FORBIDDEN");
    expect(await db.session.count()).toBe(0);
  });
});
