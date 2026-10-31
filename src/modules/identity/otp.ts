import "server-only";
import { randomInt } from "node:crypto";
import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { SYSTEM, recordAudit } from "@/modules/audit";
import { notifyOperators, smsProvider } from "@/modules/notifications";
import { hashPii, safeEqual } from "@/platform/crypto";
import { db, transaction } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { enforceRateLimit, hitRateLimit, type RateLimitRule } from "@/platform/rate-limit";
import { parsePhone, type Phone } from "./phone";
import { startSession } from "./session";

const t = ru.identity.otp;

export const OTP_TTL_MIN = 5;
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Лимиты: повтор кода — раз в минуту; на номер — 5 кодов в час, 10 кодов и 20 проверок в сутки
 * (с любых IP: перебор кода с разных адресов упирается в номер); с одного IP — 20 запросов и 50 проверок в час.
 * IP неизвестен (ip: null) — лимиты по IP не применяются: общий ключ «unknown» дал бы один лимит на всех
 * (в production IP известен всегда — env.ts требует TRUST_PROXY=true).
 * Номерам, которых нет среди пользователей (новые регистрации), — ещё суточные потолки на префикс номера
 * (OTP_DAILY_PREFIX_LIMIT) и общий (OTP_DAILY_GLOBAL_LIMIT): рассылка по множеству номеров с множества
 * адресов упирается в них, а не в счёт за SMS. Зарегистрированных потолки не касаются — рассылка по
 * случайным номерам не закрывает вход тем, кто уже пользуется платформой.
 */
const LIMITS = {
  phoneCooldown: { limit: 1, windowSec: 60 },
  phoneHourly: { limit: 5, windowSec: 3600 },
  phoneDaily: { limit: 10, windowSec: 86_400 },
  verifyPhoneDaily: { limit: 20, windowSec: 86_400 },
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

const DAY_SEC = 86_400;

/** Первые 6 цифр номера («+77001234567» → «770012»): блок из ста тысяч соседних номеров. */
const prefixOf = (phone: Phone) => phone.replace(/\D/g, "").slice(0, 6);

/** Суточные потолки для номеров без пользователя: сначала префикс, затем общий. */
async function enforceNewPhoneCeilings(phone: Phone): Promise<void> {
  const e = env();
  await enforceRateLimit(`otp:prefix:${prefixOf(phone)}:day`, { limit: e.OTP_DAILY_PREFIX_LIMIT, windowSec: DAY_SEC }, t.errors.tooManyGlobal);
  const global = await hitRateLimit("otp:global:day", { limit: e.OTP_DAILY_GLOBAL_LIMIT, windowSec: DAY_SEC });
  if (global.allowed) return;
  await alertGlobalCeiling(e.OTP_DAILY_GLOBAL_LIMIT);
  fail.rateLimited(t.errors.tooManyGlobal);
}

/**
 * Первое за сутки достижение общего потолка — в журнал и операторам. Счётчик «один раз в сутки» — тот же
 * атомарный rate-limit: из одновременных отказов оповещает ровно один.
 */
async function alertGlobalCeiling(limit: number): Promise<void> {
  const first = await hitRateLimit("otp:global:day:alert", { limit: 1, windowSec: DAY_SEC });
  if (!first.allowed) return;
  logger.warn("otp.global_limit_reached", { limit });
  await notifyOperators(db, "otp.global_limit", { limit });
}

export type OtpRequested = { phone: Phone; expiresAt: Date; demoCode: string | null };

/** Выдаёт новый код на номер и отправляет SMS. */
export async function requestOtp(input: { phone: string; ip: string | null }): Promise<OtpRequested> {
  const phone = phoneOrFail(input.phone);
  if (input.ip) await enforceRateLimit(`otp:ip:${input.ip}`, LIMITS.ipHourly, t.errors.tooManyRequests);
  await enforceRateLimit(`otp:phone:${phone}:cooldown`, LIMITS.phoneCooldown, t.errors.tooOften);
  await enforceRateLimit(`otp:phone:${phone}`, LIMITS.phoneHourly, t.errors.tooManyRequests);
  await enforceRateLimit(`otp:phone:${phone}:day`, LIMITS.phoneDaily, t.errors.tooManyToday);
  // Последними: запросы, отклонённые лимитами номера и IP, потолки не расходуют.
  if (!(await db.user.findUnique({ where: { phone }, select: { id: true } }))) await enforceNewPhoneCeilings(phone);

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
export async function verifyOtp(input: { phone: string; code: string; ip: string | null; userAgent?: string }): Promise<OtpVerified> {
  const phone = phoneOrFail(input.phone);
  if (input.ip) await enforceRateLimit(`otp:verify:ip:${input.ip}`, LIMITS.verifyIpHourly);
  await enforceRateLimit(`otp:verify:phone:${phone}:day`, LIMITS.verifyPhoneDaily, t.errors.tooManyToday);

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
