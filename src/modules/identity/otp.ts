import "server-only";
import { randomInt } from "node:crypto";
import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { SYSTEM, recordAudit } from "@/modules/audit";
import { smsProvider } from "@/modules/notifications";
import { hashPii, safeEqual } from "@/platform/crypto";
import { db, transaction } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { enforceRateLimit, type RateLimitRule } from "@/platform/rate-limit";
import { parsePhone, type Phone } from "./phone";
import { startSession } from "./session";

const t = ru.identity.otp;

export const OTP_TTL_MIN = 5;
export const OTP_MAX_ATTEMPTS = 5;

/** Лимиты: повтор кода — раз в минуту, 5 кодов в час на номер, 20 запросов и 50 проверок в час с одного IP. */
const LIMITS = {
  phoneCooldown: { limit: 1, windowSec: 60 },
  phoneHourly: { limit: 5, windowSec: 3600 },
  ipHourly: { limit: 20, windowSec: 3600 },
  verifyIpHourly: { limit: 50, windowSec: 3600 },
} satisfies Record<string, RateLimitRule>;

function phoneOrFail(raw: string): Phone {
  return parsePhone(raw) ?? fail.validation(t.errors.invalidPhone);
}

/** HMAC кода с ключом PII_HASH_KEY: без ключа по дампу БД код не подобрать. Номер — в составе, чтобы хэш не переносился. */
function codeHash(phone: Phone, code: string): string {
  return hashPii(`otp:v1:${phone}:${code}`);
}

/** Код показывается на экране только в демо с мок-SMS: настоящая SMS никуда не уходит. */
function showsDemoCode(): boolean {
  const e = env();
  return e.DEMO_MODE && e.SMS_PROVIDER === "mock";
}

export type OtpRequested = { phone: Phone; expiresAt: Date; demoCode: string | null };

/** Выдаёт новый код на номер и отправляет SMS. */
export async function requestOtp(input: { phone: string; ip: string }): Promise<OtpRequested> {
  const phone = phoneOrFail(input.phone);
  await enforceRateLimit(`otp:ip:${input.ip}`, LIMITS.ipHourly, t.errors.tooManyRequests);
  await enforceRateLimit(`otp:phone:${phone}:cooldown`, LIMITS.phoneCooldown, t.errors.tooOften);
  await enforceRateLimit(`otp:phone:${phone}`, LIMITS.phoneHourly, t.errors.tooManyRequests);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);
  // Действует только последний выданный код: verifyOtp берёт самый свежий.
  await db.otpCode.create({ data: { phone, codeHash: codeHash(phone, code), expiresAt } });
  await smsProvider().send({ phone, text: t.sms(code) });

  return { phone, expiresAt, demoCode: showsDemoCode() ? code : null };
}

/** Кто вошёл: этого хватает, чтобы выбрать экран после входа (homePathFor). */
export type OtpVerified = {
  userId: string;
  role: Role;
  executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null;
  isNew: boolean;
};

/**
 * Проверяет код и начинает сессию. Попытка засчитывается до сравнения (атомарно),
 * поэтому параллельный перебор не обходит лимит; код гасится условным update —
 * два одновременных входа с одним кодом дают одну сессию.
 */
export async function verifyOtp(input: { phone: string; code: string; ip: string; userAgent?: string }): Promise<OtpVerified> {
  const phone = phoneOrFail(input.phone);
  await enforceRateLimit(`otp:verify:ip:${input.ip}`, LIMITS.verifyIpHourly);

  const otp = await db.otpCode.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return fail.validation(t.errors.expired);

  const counted = await db.otpCode.updateMany({
    where: { id: otp.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count !== 1) return fail.rateLimited(t.errors.attemptsExhausted);

  if (!safeEqual(otp.codeHash, codeHash(phone, input.code.trim()))) {
    const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
    return left > 0 ? fail.validation(t.errors.wrongCode(left)) : fail.rateLimited(t.errors.attemptsExhausted);
  }

  const result = await transaction(async (tx) => {
    const consumed = await tx.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) return fail.validation(t.errors.expired);

    const existing = await tx.user.findUnique({ where: { phone }, include: { executorProfile: { select: { status: true } } } });
    if (existing?.blockedAt) return fail.forbidden(t.errors.blocked);
    if (existing) return { userId: existing.id, role: existing.role, executor: existing.executorProfile, isNew: false };

    const created = await tx.user.create({ data: { phone, role: "CLIENT" } });
    await recordAudit(tx, {
      actor: SYSTEM("identity.otp"),
      action: "user.registered",
      entity: { type: "user", id: created.id },
      after: { role: created.role },
    });
    return { userId: created.id, role: created.role, executor: null, isNew: true };
  });

  await startSession(result.userId, input.userAgent);
  return result;
}
