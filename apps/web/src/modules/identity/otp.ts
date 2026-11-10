import "server-only";
import { randomUUID } from "node:crypto";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { parsePhone, type Phone } from "./phone";
import { roleFromProto } from "./projection";
import { identity, identityClientIp } from "./remote";
import { identityFailure, isTransient } from "./remote-errors";
import { newSessionToken } from "./session-cookie";
import { beginSession, currentToken, signOutPrevious } from "./session";

const t = ru.identity.otp;

/** Срок кода, попытки и лимиты ведёт identity; здесь — приведение номера и вызовы. */
const USER_AGENT_MAX = 300;

function phoneOrFail(raw: string): Phone {
  return parsePhone(raw) ?? fail.validation(t.errors.invalidPhone);
}

export type OtpRequested = { phone: Phone; expiresAt: Date; demoCode: string | null };

/**
 * Обрыв связи или дедлайн: identity мог выполнить вызов, а ответ не дойти. Повтор — один, с тем же запросом (тот же
 * ключ идемпотентности): identity вернёт ответ первого вызова, а не отказ по лимиту или «код устарел».
 */
async function retriedOnce<R>(call: () => Promise<R>): Promise<R> {
  try {
    return await call();
  } catch (first) {
    if (!isTransient(first)) return identityFailure(first);
    try {
      return await call();
    } catch (second) {
      return identityFailure(second);
    }
  }
}

/**
 * Просит identity выдать код на номер. Демо-код возвращается, только когда его вернул сам identity (DEMO_MODE и мок-SMS там).
 * Потерянный ответ повторяется с тем же ключом: SMS уже ушла, а без повтора человек минуту видел бы «слишком часто».
 */
export async function requestOtp(input: { phone: string; ip: string | null }): Promise<OtpRequested> {
  const phone = phoneOrFail(input.phone);
  const request = { phone, clientIp: identityClientIp(input.ip), idempotencyKey: randomUUID() };
  const res = await retriedOnce(() => identity().requestOtp(request));
  if (!res.expiresAt) {
    logger.error("identity.call_rejected", { reason: "request_otp_without_expiry" });
    return fail.unavailable(ru.common.errors.generic);
  }
  return { phone, expiresAt: timestampDate(res.expiresAt), demoCode: res.demoCode === "" ? null : res.demoCode };
}

/** Кто вошёл: этого хватает, чтобы выбрать экран после входа (homePathFor). */
export type OtpVerified = {
  userId: string;
  role: Role;
  executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null;
  isNew: boolean;
};

/**
 * Проверяет код в identity и начинает сессию: токен придумывает web, прежняя сессия этого браузера отзывается,
 * ответ пишется в проекцию, cookie живёт до конца сессии. Статус профиля исполнителя — из старой базы.
 */
export async function verifyOtp(input: { phone: string; code: string; ip: string | null; userAgent?: string }): Promise<OtpVerified> {
  const phone = phoneOrFail(input.phone);
  const previous = await currentToken();

  const token = newSessionToken();
  // Повтор после обрыва — с тем же ключом и тем же токеном: тот же пользователь, одна сессия.
  const request = {
    phone,
    code: input.code.trim(),
    clientIp: identityClientIp(input.ip),
    userAgent: (input.userAgent ?? "").slice(0, USER_AGENT_MAX),
    sessionToken: token,
    idempotencyKey: randomUUID(),
  };
  const res = await retriedOnce(() => identity().verifyOtp(request));
  const { user, session } = await beginSession(token, res);
  // Только после успешного входа: неверный код старую сессию браузера не заканчивает.
  await signOutPrevious(previous);

  const profile = await db.executorProfile.findUnique({ where: { userId: user.id }, select: { status: true } });
  return { userId: user.id, role: roleFromProto(session.activeRole), executor: profile, isNew: res.isNew };
}
