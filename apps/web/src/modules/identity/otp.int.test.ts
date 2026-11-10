import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role as ProtoRole } from "@/gen/senim/identity/v1/identity_pb";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeExecutor } from "../../../test/factories";
import { cookieOptions, cookieValue, freshBrowser, putCookie, setEnv } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { FAKE_OTP_CODE, identityFake } from "../../../test/stubs/identity";
import { requestOtp, verifyOtp } from "./otp";
import { getCurrentUser } from "./session";
import { sessionCookieName } from "./session-cookie";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

const PHONE = "+77000005501";
const IP = "203.0.113.7";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COOKIE = () => cookieValue(sessionCookieName());

beforeEach(() => {
  freshBrowser();
  setEnv({ DEMO_MODE: "true", SMS_PROVIDER: "mock" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function codeFor(phone = PHONE, ip: string | null = IP): Promise<string> {
  const { demoCode } = await requestOtp({ phone, ip });
  if (!demoCode) throw new Error("подделка в демо-режиме возвращает код");
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

const callsOf = (method: string) => identityFake.calls.filter((c) => c.method === method).map((c) => c.request as Record<string, unknown>);

describe("requestOtp", () => {
  it("номер приводится к +7XXXXXXXXXX, IP — одиночный адрес, ключ — случайный UUID", async () => {
    await requestOtp({ phone: "8 700 000 55 01", ip: IP });
    await requestOtp({ phone: PHONE, ip: IP });

    const [first, second] = callsOf("requestOtp");
    expect(first).toMatchObject({ phone: PHONE, clientIp: IP });
    expect(first.idempotencyKey).toMatch(UUID);
    expect(second.idempotencyKey).toMatch(UUID);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("IP неизвестен или не адрес — identity получает пустую строку", async () => {
    await requestOtp({ phone: PHONE, ip: null });
    await requestOtp({ phone: PHONE, ip: "203.0.113.7:4443, 10.0.0.1" });

    expect(callsOf("requestOtp").map((c) => c.clientIp)).toEqual(["", ""]);
  });

  it("возвращает номер, срок и демо-код, когда его вернул identity", async () => {
    const before = Date.now();
    const sent = await requestOtp({ phone: "+7 700 000 55 01", ip: IP });

    expect(sent).toEqual({ phone: PHONE, expiresAt: expect.any(Date), demoCode: FAKE_OTP_CODE });
    expect(sent.expiresAt.getTime()).toBeGreaterThan(before + 4 * 60_000);
  });

  it("identity не вернул демо-код — null", async () => {
    identityFake.demoEnabled = false;
    expect((await requestOtp({ phone: PHONE, ip: IP })).demoCode).toBeNull();
  });

  it("не казахстанский номер отклоняется на месте, identity не вызывается", async () => {
    expect((await errorOf(requestOtp({ phone: "+7 912 000 00 00", ip: IP }))).code).toBe("VALIDATION");
    expect(identityFake.calls).toHaveLength(0);
  });

  it("отказ identity по лимиту — RATE_LIMITED с русским текстом", async () => {
    identityFake.failNextWithCode("otp_too_often");

    const e = await errorOf(requestOtp({ phone: PHONE, ip: IP }));

    expect(e.code).toBe("RATE_LIMITED");
    expect(e.message).toMatch(/минуту/);
    expect(callsOf("requestOtp")).toHaveLength(1); // отказ по делу не повторяется
  });

  it("ответ потерян после выдачи кода: повтор с тем же ключом, код один, без «слишком часто»", async () => {
    identityFake.failNextAfterEffect();

    const sent = await requestOtp({ phone: PHONE, ip: IP });

    const [first, second] = callsOf("requestOtp");
    expect(callsOf("requestOtp")).toHaveLength(2);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(sent.phone).toBe(PHONE);
  });

  it("DEADLINE_EXCEEDED тоже повторяется один раз", async () => {
    identityFake.failNext(new ConnectError("deadline", Code.DeadlineExceeded));

    await requestOtp({ phone: PHONE, ip: IP });

    expect(callsOf("requestOtp")).toHaveLength(2);
  });

  it("повтор ровно один: второй обрыв подряд — «сервис недоступен»", async () => {
    identityFake.failNextUnavailable();
    identityFake.failNextUnavailable();

    expect((await errorOf(requestOtp({ phone: PHONE, ip: IP }))).code).toBe("UNAVAILABLE");
    expect(callsOf("requestOtp")).toHaveLength(2);
  });
});

describe("verifyOtp", () => {
  it("верный код: новый телефон становится заказчиком, ставится сессия и проекция", async () => {
    const code = await codeFor();

    const result = await verifyOtp({ phone: "+7 700 000 55 01", code, ip: IP, userAgent: "vitest" });

    expect(result).toMatchObject({ isNew: true, role: "CLIENT", executor: null });
    expect(COOKIE()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await getCurrentUser()).toMatchObject({ id: result.userId, phone: PHONE, role: "CLIENT" });
    expect(await db.user.findUniqueOrThrow({ where: { id: result.userId } })).toMatchObject({ phone: PHONE, roles: ["CLIENT"] });
    expect(callsOf("verifyOtp")[0]).toMatchObject({ phone: PHONE, code, clientIp: IP, userAgent: "vitest", sessionToken: COOKIE() });
    expect(callsOf("verifyOtp")[0].idempotencyKey).toMatch(UUID);
  });

  it("cookie ставится с expires сессии identity", async () => {
    const verify = vi.spyOn(identityFake.client, "verifyOtp");
    const code = await codeFor();

    await verifyOtp({ phone: PHONE, code, ip: IP });

    const session = (await verify.mock.results[0].value).session;
    expect(cookieOptions(sessionCookieName())).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", expires: timestampDate(session.expiresAt) });
  });

  it("существующий пользователь входит со своей ролью", async () => {
    const existing = identityFake.addUser({ phone: PHONE, defaultRole: ProtoRole.OPERATOR, roles: [ProtoRole.OPERATOR] });
    const code = await codeFor();

    expect(await verifyOtp({ phone: PHONE, code, ip: IP })).toMatchObject({ userId: existing.id, role: "OPERATOR", isNew: false });
  });

  it("исполнителю возвращает статус профиля — для выбора экрана после входа", async () => {
    const ex = await makeExecutor({ status: "PENDING" });
    identityFake.addUser({ id: ex.id, phone: ex.phone, defaultRole: ProtoRole.EXECUTOR, roles: [ProtoRole.EXECUTOR] });
    const code = await codeFor(ex.phone);

    expect(await verifyOtp({ phone: ex.phone, code, ip: IP })).toMatchObject({ userId: ex.id, role: "EXECUTOR", executor: { status: "PENDING" } });
  });

  it("неверный код: ошибка с числом оставшихся попыток, cookie нет, повтора нет", async () => {
    await codeFor();

    const e = await errorOf(verifyOtp({ phone: PHONE, code: "000000", ip: IP }));

    expect(e.code).toBe("VALIDATION");
    expect(e.message).toMatch(/4/);
    expect(COOKIE()).toBeUndefined();
    expect(callsOf("verifyOtp")).toHaveLength(1);
  });

  it("код не запрашивался — «код устарел», заблокированный — FORBIDDEN", async () => {
    expect((await errorOf(verifyOtp({ phone: PHONE, code: FAKE_OTP_CODE, ip: IP }))).code).toBe("VALIDATION");

    identityFake.addUser({ phone: PHONE, blocked: true });
    const code = await codeFor();
    expect((await errorOf(verifyOtp({ phone: PHONE, code, ip: IP }))).code).toBe("FORBIDDEN");
    expect(COOKIE()).toBeUndefined();
  });

  it("обрыв после VerifyOtp: повтор с тем же ключом и токеном, вход один", async () => {
    const code = await codeFor();
    identityFake.failNextAfterEffect();

    const result = await verifyOtp({ phone: PHONE, code, ip: IP });

    const [first, second] = callsOf("verifyOtp");
    expect(callsOf("verifyOtp")).toHaveLength(2);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.sessionToken).toBe(first.sessionToken);
    expect(identityFake.sessionCount()).toBe(1);
    expect(COOKIE()).toBe(first.sessionToken);
    expect(await getCurrentUser()).toMatchObject({ id: result.userId });
  });

  it("DEADLINE_EXCEEDED тоже повторяется один раз", async () => {
    const code = await codeFor();
    identityFake.failNext(new ConnectError("deadline", Code.DeadlineExceeded));

    await verifyOtp({ phone: PHONE, code, ip: IP });

    expect(callsOf("verifyOtp")).toHaveLength(2);
    expect(identityFake.sessionCount()).toBe(1);
  });

  it("повтор ровно один: второй обрыв подряд — «сервис недоступен», cookie нет", async () => {
    const code = await codeFor();
    identityFake.failNextUnavailable();
    identityFake.failNextUnavailable();

    const e = await errorOf(verifyOtp({ phone: PHONE, code, ip: IP }));

    expect(e.code).toBe("UNAVAILABLE");
    expect(callsOf("verifyOtp")).toHaveLength(2);
    expect(COOKIE()).toBeUndefined();
  });

  it("успешный вход отзывает прежнюю сессию браузера", async () => {
    const person = await makeExecutor();
    const oldToken = await signInAs(person);
    const code = await codeFor();

    await verifyOtp({ phone: PHONE, code, ip: IP });

    expect(callsOf("signOut")[0]).toMatchObject({ sessionToken: oldToken });
    expect(identityFake.sessionCount(person.id)).toBe(0);
    putCookie(sessionCookieName(), oldToken);
    expect(await getCurrentUser()).toBeNull();
  });

  it("неверный код — прежняя сессия жива, SignOut не вызывается", async () => {
    const person = await makeExecutor();
    const oldToken = await signInAs(person);
    await codeFor();

    await errorOf(verifyOtp({ phone: PHONE, code: "000000", ip: IP }));

    expect(callsOf("signOut")).toHaveLength(0);
    expect(COOKIE()).toBe(oldToken);
    expect(await getCurrentUser()).toMatchObject({ id: person.id });
  });

  it("сбой выхода из прежней сессии вход не мешает; cookie неверного вида не отправляется", async () => {
    await signInAs(await makeExecutor());
    const code = await codeFor();
    vi.spyOn(identityFake.client, "signOut").mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable));
    await expect(verifyOtp({ phone: PHONE, code, ip: IP })).resolves.toMatchObject({ isNew: true });
    expect(COOKIE()).toMatch(/^[A-Za-z0-9_-]{43}$/);

    freshBrowser();
    putCookie(sessionCookieName(), "кривой-токен");
    const code2 = await codeFor("+77000005502");
    await verifyOtp({ phone: "+77000005502", code: code2, ip: IP });
    expect(callsOf("signOut")).toHaveLength(0);
  });
});
