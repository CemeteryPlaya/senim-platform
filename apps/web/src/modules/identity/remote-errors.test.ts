import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { AppError, type ErrorCode } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { codedError } from "../../../test/stubs/identity";
import { IDENTITY_ERROR_CODES, identityFailure } from "./remote-errors";

afterEach(() => vi.restoreAllMocks());

const otp = ru.identity.otp.errors;
const g = ru.common.errors;

function caught(err: unknown): AppError {
  try {
    identityFailure(err);
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("identityFailure не бросил ошибку");
}

const table: Record<(typeof IDENTITY_ERROR_CODES)[number], { code: ErrorCode; message: string; params?: Record<string, string> }> = {
  invalid_phone: { code: "VALIDATION", message: otp.invalidPhone },
  otp_too_often: { code: "RATE_LIMITED", message: otp.tooOften },
  otp_too_many_requests: { code: "RATE_LIMITED", message: otp.tooManyRequests },
  otp_too_many_today: { code: "RATE_LIMITED", message: otp.tooManyToday },
  otp_global_limit: { code: "RATE_LIMITED", message: otp.tooManyGlobal },
  otp_expired: { code: "VALIDATION", message: otp.expired },
  otp_wrong_code: { code: "VALIDATION", message: otp.wrongCode(3), params: { left: "3" } },
  otp_attempts_exhausted: { code: "RATE_LIMITED", message: otp.attemptsExhausted },
  user_blocked: { code: "FORBIDDEN", message: otp.blocked },
  session_invalid: { code: "UNAUTHENTICATED", message: g.unauthenticated },
  session_token_invalid: { code: "UNAVAILABLE", message: g.generic },
  role_not_granted: { code: "FORBIDDEN", message: ru.identity.switchRole.notGranted },
  role_forbidden: { code: "FORBIDDEN", message: g.notAllowed },
  demo_disabled: { code: "FORBIDDEN", message: ru.identity.demo.disabled },
  user_not_found: { code: "NOT_FOUND", message: g.notFoundShort },
  caller_forbidden: { code: "UNAVAILABLE", message: g.generic },
  idempotency_key_reused: { code: "UNAVAILABLE", message: g.generic },
  invalid_request: { code: "UNAVAILABLE", message: g.generic },
};

describe("identityFailure", () => {
  it.each(IDENTITY_ERROR_CODES)("код %s даёт ожидаемую ошибку и русский текст", (code) => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const want = table[code];
    const err = caught(codedError(code, Code.Unknown, want.params));
    expect(err.code).toBe(want.code);
    expect(err.message).toBe(want.message);
  });

  it("таблица покрывает весь контракт: 18 кодов", () => {
    expect(IDENTITY_ERROR_CODES).toHaveLength(18);
    expect(Object.keys(table).sort()).toEqual([...IDENTITY_ERROR_CODES].sort());
  });

  it("otp_wrong_code с left=3 — «Осталось попыток: 3»", () => {
    expect(caught(codedError("otp_wrong_code", Code.InvalidArgument, { left: "3" })).message).toBe("Неверный код. Осталось попыток: 3");
  });

  it("otp_wrong_code без разбираемого left — общий текст", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const bad: Record<string, string>[] = [{}, { left: "abc" }, { left: "-1" }];
    for (const params of bad) {
      expect(caught(codedError("otp_wrong_code", Code.InvalidArgument, params)).message).toBe(g.generic);
    }
  });

  it("ошибки контракта пишутся в лог кодом, а человеку показывается общий текст", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    const err = caught(codedError("invalid_request", Code.InvalidArgument));
    expect(err.message).toBe(g.generic);
    expect(err.message).not.toContain("invalid_request");
    expect(log).toHaveBeenCalledWith("identity.call_rejected", { reason: "invalid_request" });
  });

  it.each([Code.Unavailable, Code.DeadlineExceeded])("статус %s без ErrorDetail — «сервис недоступен»", (status) => {
    const err = caught(new ConnectError("x", status));
    expect(err.code).toBe("UNAVAILABLE");
    expect(err.message).toBe(g.unavailable);
  });

  it("неизвестный код или не ConnectError — запись в лог и общий текст", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(caught(codedError("brand_new_code", Code.Internal)).message).toBe(g.generic);
    expect(caught(new Error("boom")).message).toBe(g.generic);
    expect(caught(new ConnectError("x", Code.Internal)).message).toBe(g.generic);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it("AppError пропускает как есть", () => {
    const original = new AppError("CONFLICT", "x");
    expect(caught(original)).toBe(original);
  });
});
