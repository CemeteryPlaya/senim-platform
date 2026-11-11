import { Code, ConnectError } from "@connectrpc/connect";
import { ru } from "@/i18n/ru";
import { ErrorDetailSchema } from "@/gen/senim/common/v1/error_pb";
import { AppError, fail } from "@/platform/errors";
import { logger } from "@/platform/logger";

const otp = ru.identity.otp.errors;
const mfa = ru.identity.mfa.errors;
const person = ru.identity.clientIdentity;
const contacts = ru.identity.contacts;
const registration = ru.identity.registration.errors;
const payout = ru.identity.payout.errors;

/** Коды, которые identity возвращает по контракту (proto/senim/identity/v1/identity.proto). */
export const IDENTITY_ERROR_CODES = [
  "invalid_phone",
  "otp_too_often",
  "otp_too_many_requests",
  "otp_too_many_today",
  "otp_global_limit",
  "otp_expired",
  "otp_wrong_code",
  "otp_attempts_exhausted",
  "user_blocked",
  "session_invalid",
  "session_token_invalid",
  "role_not_granted",
  "role_forbidden",
  "demo_disabled",
  "user_not_found",
  "caller_forbidden",
  "idempotency_key_reused",
  "invalid_request",
  "mfa_required",
  "mfa_not_required",
  "mfa_not_enrolled",
  "mfa_already_enrolled",
  "mfa_wrong_code",
  "mfa_code_reused",
  "mfa_too_many_attempts",
  "full_name_invalid",
  "iin_invalid",
  "iin_taken",
  "person_already_recorded",
  "person_too_many_attempts",
  "instagram_invalid",
  "email_invalid",
  "person_missing",
  "bin_iin_invalid",
  "signer_required",
  "iban_invalid",
  "party_missing",
  "party_exists",
  "pii_key_unknown",
] as const;

export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[number];

/** Сбой на нашей стороне (контракт, токен, ключ, конфигурация): человеку причину не показываем. */
function broken(reason: string, cause?: unknown): never {
  // cause — Error: логгер пишет только имя, сообщение (с маской телефонов и 12 цифр) и стек; токенов и телефонов в таких сообщениях нет.
  logger.error("identity.call_rejected", cause === undefined ? { reason } : { reason, cause });
  throw new AppError("UNAVAILABLE", ru.common.errors.generic);
}

/** params.left кодов otp_wrong_code и mfa_wrong_code: сколько попыток осталось; не число — сбой контракта. */
function attemptsLeft(code: "otp_wrong_code" | "mfa_wrong_code", params: Record<string, string>): number {
  const raw = params["left"];
  if (raw === undefined || !/^\d{1,2}$/.test(raw)) return broken(`${code}_without_left`);
  return Number(raw);
}

/** params.max кода instagram_invalid: предел длины имени; нет — имя с недопустимыми символами; не число — сбой контракта. */
function instagramMax(params: Record<string, string>): number | null {
  const raw = params["max"];
  if (raw === undefined) return null;
  if (!/^\d{1,3}$/.test(raw)) return broken("instagram_invalid_bad_max");
  return Number(raw);
}

/** params.reason кода iban_invalid: format или checksum (свои тексты); иное — сбой контракта. */
function ibanReason(params: Record<string, string>): "format" | "checksum" {
  const reason = params["reason"];
  if (reason === "format" || reason === "checksum") return reason;
  return broken("iban_invalid_bad_reason");
}

/** Ошибка формата одного поля формы: текст и он же у поля (формы показывают его под полем). */
function fieldInvalid(field: string, message: string): never {
  return fail.validation(message, { fieldErrors: { [field]: [message] } });
}

/** Каждый код контракта → ошибка приложения. Тип `never` в `default` не даёт забыть новый код. */
function byCode(code: IdentityErrorCode, params: Record<string, string>): never {
  switch (code) {
    case "invalid_phone":
      return fail.validation(otp.invalidPhone);
    case "otp_too_often":
      return fail.rateLimited(otp.tooOften);
    case "otp_too_many_requests":
      return fail.rateLimited(otp.tooManyRequests);
    case "otp_too_many_today":
      return fail.rateLimited(otp.tooManyToday);
    case "otp_global_limit":
      return fail.rateLimited(otp.tooManyGlobal);
    case "otp_expired":
      return fail.validation(otp.expired);
    case "otp_wrong_code":
      return fail.validation(otp.wrongCode(attemptsLeft(code, params)));
    case "otp_attempts_exhausted":
      return fail.rateLimited(otp.attemptsExhausted);
    case "user_blocked":
      return fail.forbidden(otp.blocked);
    case "session_invalid":
      return fail.unauthenticated();
    case "role_not_granted":
      return fail.forbidden(ru.identity.switchRole.notGranted);
    case "role_forbidden":
      return fail.forbidden();
    case "demo_disabled":
      return fail.forbidden(ru.identity.demo.disabled);
    case "user_not_found":
      return fail.notFound();
    case "mfa_required":
      return fail.mfaRequired();
    case "mfa_not_required":
      return fail.forbidden(mfa.notRequired);
    case "mfa_not_enrolled":
      return fail.conflict(mfa.notEnrolled);
    case "mfa_already_enrolled":
      return fail.conflict(mfa.alreadyEnrolled);
    case "mfa_wrong_code":
      return fail.validation(mfa.wrongCode(attemptsLeft(code, params)));
    case "mfa_code_reused":
      return fail.validation(mfa.reused);
    case "mfa_too_many_attempts":
      return fail.rateLimited(mfa.tooMany);
    case "full_name_invalid":
      return fieldInvalid("fullName", person.fullNameInvalid);
    case "iin_invalid":
      return fieldInvalid("iin", person.iinInvalid);
    case "iin_taken":
      return fail.conflict(person.iinTaken);
    case "person_already_recorded":
      return fail.conflict(person.alreadySet);
    case "person_too_many_attempts":
      return fail.rateLimited(person.tooMany);
    case "instagram_invalid": {
      const max = instagramMax(params);
      return fieldInvalid("instagram", max === null ? contacts.instagramInvalid : contacts.instagramTooLong(max));
    }
    case "email_invalid":
      return fieldInvalid("email", contacts.emailInvalid);
    case "person_missing":
      return fieldInvalid("binIin", registration.personMissing);
    case "bin_iin_invalid":
      return fieldInvalid("binIin", registration.binIinInvalid);
    case "signer_required":
      return fail.validation(registration.signerRequired);
    case "iban_invalid":
      return fieldInvalid("iban", payout[ibanReason(params)]);
    case "party_missing":
      return fail.conflict(payout.partyMissing);
    case "party_exists":
      return fail.conflict(registration.partyExists);
    case "session_token_invalid":
    case "caller_forbidden":
    case "idempotency_key_reused":
    case "invalid_request":
    case "pii_key_unknown":
      return broken(code);
    default: {
      const unreachable: never = code;
      return broken(String(unreachable));
    }
  }
}

const isKnown = (code: string): code is IdentityErrorCode => (IDENTITY_ERROR_CODES as readonly string[]).includes(code);

/**
 * Обрыв связи или дедлайн: результат вызова неизвестен, изменяющий вызов можно повторить с тем же ключом идемпотентности.
 * Ответ identity с кодом ошибки (`ErrorDetail`) — не обрыв, даже если статус `Unavailable`.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof AppError) return false;
  const e = ConnectError.from(err);
  return (e.code === Code.Unavailable || e.code === Code.DeadlineExceeded) && e.findDetails(ErrorDetailSchema).length === 0;
}

/**
 * Тексты отдельных кодов на месте вызова: один код контракта значит разное в разных методах (iin_taken у RecordPerson —
 * ИИН личности, у RegisterParty — ИИН/БИН стороны). Функция бросает `fail.*`.
 */
export type IdentityErrorOverrides = Partial<Record<IdentityErrorCode, () => never>>;

/** Ошибка вызова identity → `fail.*` с русским текстом. Всегда бросает. */
export function identityFailure(err: unknown, overrides: IdentityErrorOverrides = {}): never {
  if (err instanceof AppError) throw err;
  const e = ConnectError.from(err);
  const detail = e.findDetails(ErrorDetailSchema)[0];
  if (detail) {
    if (isKnown(detail.code)) {
      const override = overrides[detail.code];
      return override ? override() : byCode(detail.code, detail.params);
    }
    return broken(`unknown_code:${detail.code}`);
  }
  if (e.code === Code.Unavailable || e.code === Code.DeadlineExceeded) return fail.unavailable();
  return broken(`status:${Code[e.code] ?? "unknown"}`, err instanceof Error ? err : new Error(e.rawMessage));
}

/**
 * Обрыв связи или дедлайн: identity мог выполнить вызов, а ответ не дойти. Повтор — один, с тем же запросом (тот же
 * ключ идемпотентности): identity вернёт ответ первого вызова, а не отказ по лимиту или «уже указано». Любой отказ —
 * `identityFailure`.
 */
export async function retriedOnce<R>(call: () => Promise<R>, overrides: IdentityErrorOverrides = {}): Promise<R> {
  try {
    return await call();
  } catch (first) {
    if (!isTransient(first)) return identityFailure(first, overrides);
    try {
      return await call();
    } catch (second) {
      return identityFailure(second, overrides);
    }
  }
}
