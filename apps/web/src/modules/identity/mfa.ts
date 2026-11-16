import "server-only";
import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { rpcErrorCode } from "@/platform/rpc";
import { identity } from "./remote";
import { identityFailure } from "./remote-errors";
import { currentSessionToken, getCurrentUser, type CurrentUser } from "./session";

/**
 * Второй фактор оператора (TOTP, спека §4.4): подключение приложения-аутентификатора, вторая ступень входа и
 * повторный код перед действием с деньгами. Код и секрет проверяет identity; web не хранит ни того, ни другого.
 */

export type TotpEnrollment = {
  /** Секрет в base32 — для ручного ввода в приложение. Не логировать. */
  secret: string;
  otpauthUrl: string;
  /** Тот же URI как QR-код (SVG). */
  qrSvg: string;
};

const TOTP_CODE = /^\d{6}$/;

/** Код из приложения: шесть цифр, пробелы (в приложении код показан «123 456») убираются. Иначе — VALIDATION без вызова identity. */
function totpCode(raw: string): string {
  const code = raw.replace(/\s+/g, "");
  return TOTP_CODE.test(code) ? code : fail.validation(ru.identity.mfa.errors.format);
}

/** otpauth://totp/<бренд>:<телефон>?secret=…&issuer=<бренд>&digits=6&period=30 (Key Uri Format; бренд — brand.ts). */
function otpauthUrl(phone: string, secret: string): string {
  const issuer = encodeURIComponent(brand.name);
  return `otpauth://totp/${issuer}:${encodeURIComponent(phone)}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
}

/**
 * Для экрана второй ступени: человек этой сессии, которому нужен второй фактор (оператор), — без требования, чтобы
 * он уже был пройден (иначе на экран не попасть). Гость — UNAUTHENTICATED, другая роль — FORBIDDEN.
 */
export async function requireMfaUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) return fail.unauthenticated();
  if (!user.mfa.required) return fail.forbidden(ru.identity.mfa.errors.notRequired);
  return user;
}

/**
 * Ключ идемпотентности подключения приложения в этой сессии: один и тот же при каждом открытии экрана (хэш токена
 * сессии, сам токен в ключ не попадает). По тому же ключу identity отдаёт тот же неподтверждённый секрет, поэтому
 * обновление экрана (в том числе само, при возврате во вкладку) не меняет QR-код и ключ, переписанный в приложение.
 */
function enrollmentKey(sessionToken: string): string {
  return `totp-enroll:${createHash("sha256").update(`totp-enroll\0${sessionToken}`).digest("base64url")}`;
}

/** Секрет подключения от identity по ключу; `null` — приложение уже подключено. Прочие отказы identity — наружу. */
async function enrollmentSecret(sessionToken: string, idempotencyKey: string): Promise<string | null> {
  try {
    return (await identity().startTotpEnrollment({ sessionToken, idempotencyKey })).secretBase32;
  } catch (e) {
    if (rpcErrorCode(e) === "mfa_already_enrolled") return null;
    throw e;
  }
}

/**
 * Начать подключение: identity выдаёт секрет для приложения-аутентификатора. В пределах сессии секрет один и тот же
 * (ключ идемпотентности от сессии — `enrollmentKey`): QR-код не меняется при обновлении экрана. Если секрет этой сессии
 * уже заменён (подключение начали в другой сессии или фактор сбросили — identity отвечает idempotency_key_reused), —
 * новый секрет по новому ключу. null — приложение уже подключено: экран спрашивает код.
 */
export async function startTotpEnrollment(user: CurrentUser): Promise<TotpEnrollment | null> {
  const sessionToken = await currentSessionToken();
  let secret: string | null;
  try {
    secret = await enrollmentSecret(sessionToken, enrollmentKey(sessionToken)).catch((e: unknown) => {
      if (rpcErrorCode(e) === "idempotency_key_reused") return enrollmentSecret(sessionToken, randomUUID());
      throw e;
    });
  } catch (e) {
    return identityFailure(e);
  }
  if (secret === null) return null;
  const url = otpauthUrl(user.phone, secret);
  return { secret, otpauthUrl: url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
}

/** Первый верный код подключает приложение; вторая ступень этой сессии пройдена. */
export async function confirmTotpEnrollment(_user: CurrentUser, rawCode: string): Promise<void> {
  const code = totpCode(rawCode);
  const sessionToken = await currentSessionToken();
  try {
    await identity().confirmTotpEnrollment({ sessionToken, code, idempotencyKey: randomUUID() });
  } catch (e) {
    return identityFailure(e);
  }
}

/** Вторая ступень входа или повторный код перед действием с деньгами: верный код отмечает сессию «пройдено сейчас». */
export async function verifySecondFactor(_user: CurrentUser, rawCode: string): Promise<void> {
  const code = totpCode(rawCode);
  const sessionToken = await currentSessionToken();
  try {
    await identity().verifySecondFactor({ sessionToken, code, idempotencyKey: randomUUID() });
  } catch (e) {
    return identityFailure(e);
  }
}

/**
 * Перед действием с деньгами (подтверждение, отказ и повтор операции банка, решение спора): второй фактор пройден
 * не раньше, чем MFA_STEP_UP_WINDOW назад (по умолчанию 5 минут; ровно 5 минут — ещё можно). Иначе MFA_REQUIRED:
 * форма спросит код и повторит действие. Исключений нет: оператор стенда тоже вводит код (сид выдаёт ему известный секрет).
 */
export function requireRecentMfa(user: CurrentUser, now: Date = new Date()): void {
  const { MFA_STEP_UP_WINDOW } = env();
  const at = user.mfa.verifiedAt;
  if (at === null || now.getTime() - at.getTime() > MFA_STEP_UP_WINDOW) fail.mfaRequired();
}
