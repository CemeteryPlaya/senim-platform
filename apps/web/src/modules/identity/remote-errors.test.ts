import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { AppError, fail, type ErrorCode } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { codedError } from "../../../test/stubs/identity";
import { IDENTITY_ERROR_CODES, identityFailure, isCodedRefusal } from "./remote-errors";

afterEach(() => vi.restoreAllMocks());

const otp = ru.identity.otp.errors;
const mfa = ru.identity.mfa.errors;
const g = ru.common.errors;
const person = ru.identity.clientIdentity;
const contacts = ru.identity.contacts;
const reg = ru.identity.registration.errors;
const payout = ru.identity.payout.errors;
const kyc = { ...ru.identity.kyc.errors, reason: ru.identity.kyc.reasonLength(3, 500) };

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
  mfa_required: { code: "MFA_REQUIRED", message: ru.identity.mfa.stepUp },
  mfa_not_required: { code: "FORBIDDEN", message: mfa.notRequired },
  mfa_not_enrolled: { code: "CONFLICT", message: mfa.notEnrolled },
  mfa_already_enrolled: { code: "CONFLICT", message: mfa.alreadyEnrolled },
  mfa_wrong_code: { code: "VALIDATION", message: mfa.wrongCode(3), params: { left: "3" } },
  mfa_code_reused: { code: "VALIDATION", message: mfa.reused },
  mfa_too_many_attempts: { code: "RATE_LIMITED", message: mfa.tooMany },
  full_name_invalid: { code: "VALIDATION", message: person.fullNameInvalid },
  iin_invalid: { code: "VALIDATION", message: person.iinInvalid },
  iin_taken: { code: "CONFLICT", message: person.iinTaken },
  person_already_recorded: { code: "CONFLICT", message: person.alreadySet },
  person_too_many_attempts: { code: "RATE_LIMITED", message: person.tooMany },
  instagram_invalid: { code: "VALIDATION", message: contacts.instagramInvalid },
  email_invalid: { code: "VALIDATION", message: contacts.emailInvalid },
  person_missing: { code: "VALIDATION", message: reg.personMissing },
  bin_iin_invalid: { code: "VALIDATION", message: reg.binIinInvalid },
  signer_required: { code: "VALIDATION", message: reg.signerRequired },
  iban_invalid: { code: "VALIDATION", message: payout.checksum, params: { reason: "checksum" } },
  party_missing: { code: "CONFLICT", message: payout.partyMissing },
  party_exists: { code: "CONFLICT", message: reg.partyExists },
  pii_key_unknown: { code: "UNAVAILABLE", message: g.generic },
  reveal_purpose_invalid: { code: "UNAVAILABLE", message: g.generic },
  kyc_transition_forbidden: { code: "CONFLICT", message: kyc.reviewed },
  kyc_documents_missing: { code: "CONFLICT", message: kyc.noDocuments },
  kyc_reason_invalid: { code: "VALIDATION", message: kyc.reason },
};

describe("identityFailure", () => {
  it.each(IDENTITY_ERROR_CODES)("код %s даёт ожидаемую ошибку и русский текст", (code) => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const want = table[code];
    const err = caught(codedError(code, Code.Unknown, want.params));
    expect(err.code).toBe(want.code);
    expect(err.message).toBe(want.message);
  });

  it("таблица покрывает коды входа, ролей, второго фактора, личности, контактов и реквизитов, раскрытия, KYC: 43 кода", () => {
    expect(IDENTITY_ERROR_CODES).toHaveLength(43);
    expect(Object.keys(table).sort()).toEqual([...IDENTITY_ERROR_CODES].sort());
  });

  it("otp_wrong_code с left=3 — «Осталось попыток: 3»", () => {
    expect(caught(codedError("otp_wrong_code", Code.InvalidArgument, { left: "3" })).message).toBe("Неверный код. Осталось попыток: 3");
  });

  it.each(["otp_wrong_code", "mfa_wrong_code"])("%s без разбираемого left — общий текст", (code) => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const bad: Record<string, string>[] = [{}, { left: "abc" }, { left: "-1" }];
    for (const params of bad) {
      expect(caught(codedError(code, Code.InvalidArgument, params)).message).toBe(g.generic);
    }
  });

  it("mfa_wrong_code с left=0 — попытки закончились", () => {
    expect(caught(codedError("mfa_wrong_code", Code.InvalidArgument, { left: "0" })).message).toBe(mfa.wrongCode(0));
    expect(mfa.wrongCode(0)).toMatch(/15 минут/);
  });

  it.each([
    ["full_name_invalid", "fullName", person.fullNameInvalid],
    ["iin_invalid", "iin", person.iinInvalid],
    ["instagram_invalid", "instagram", contacts.instagramInvalid],
    ["email_invalid", "email", contacts.emailInvalid],
    ["person_missing", "binIin", reg.personMissing],
    ["bin_iin_invalid", "binIin", reg.binIinInvalid],
    ["kyc_reason_invalid", "reason", kyc.reason],
  ])("%s — ошибка поля %s", (code, field, message) => {
    expect(caught(codedError(code, Code.InvalidArgument)).details).toEqual({ fieldErrors: { [field]: [message] } });
  });

  it("instagram_invalid с params.max — «Не длиннее N символов»; max не число — общий текст", () => {
    const long = caught(codedError("instagram_invalid", Code.InvalidArgument, { max: "30" }));
    expect([long.message, long.details]).toEqual([contacts.instagramTooLong(30), { fieldErrors: { instagram: [contacts.instagramTooLong(30)] } }]);
    vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(caught(codedError("instagram_invalid", Code.InvalidArgument, { max: "много" })).message).toBe(g.generic);
  });

  it("iban_invalid по params.reason: format и checksum — свои тексты у поля iban; без reason — общий текст", () => {
    for (const reason of ["format", "checksum"] as const) {
      expect(caught(codedError("iban_invalid", Code.InvalidArgument, { reason })).details).toEqual({ fieldErrors: { iban: [payout[reason]] } });
    }
    vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(caught(codedError("iban_invalid", Code.InvalidArgument)).message).toBe(g.generic);
  });

  it("текст кода можно заменить на месте вызова: iin_taken стороны — не текст ИИН личности", () => {
    const err = caught(codedError("iin_taken", Code.AlreadyExists));
    expect(err.message).toBe(person.iinTaken);
    let replaced: unknown;
    try {
      identityFailure(codedError("iin_taken", Code.AlreadyExists), { iin_taken: () => fail.conflict(reg.binIinTaken) });
    } catch (e) {
      replaced = e;
    }
    expect(replaced).toMatchObject({ code: "CONFLICT", message: reg.binIinTaken });
  });

  it("ошибки контракта пишутся в лог кодом, а человеку показывается общий текст", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    const err = caught(codedError("invalid_request", Code.InvalidArgument));
    expect(err.message).toBe(g.generic);
    expect(err.message).not.toContain("invalid_request");
    expect(log).toHaveBeenCalledWith("identity.call_rejected", { reason: "invalid_request" });
    // Ключ шифрования неизвестен identity (pii_key_unknown) — сбой конфигурации, не ошибка человека.
    expect(caught(codedError("pii_key_unknown", Code.Internal)).message).toBe(g.generic);
    expect(log).toHaveBeenCalledWith("identity.call_rejected", { reason: "pii_key_unknown" });
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
    // Без ErrorDetail причина пишется в лог: имя и сообщение исходной ошибки, а не просто «unknown».
    const [, fields] = log.mock.calls[1];
    expect(fields).toMatchObject({ reason: "status:Unknown", cause: expect.objectContaining({ message: "boom" }) });
  });

  it("isCodedRefusal: только ответ с кодом контракта; обрыв, Internal без кода и AppError — исход неизвестен", () => {
    expect(isCodedRefusal(codedError("session_invalid", Code.Unauthenticated))).toBe(true);
    expect(isCodedRefusal(codedError("kyc_transition_forbidden", Code.Unavailable))).toBe(true);
    for (const err of [new ConnectError("x", Code.Unavailable), new ConnectError("reset", Code.Internal), new ConnectError("x", Code.Unknown), new AppError("CONFLICT", "x")]) {
      expect(isCodedRefusal(err)).toBe(false);
    }
  });

  it("AppError пропускает как есть", () => {
    const original = new AppError("CONFLICT", "x");
    expect(caught(original)).toBe(original);
  });
});
