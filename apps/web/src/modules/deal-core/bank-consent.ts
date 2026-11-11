import { z } from "zod";
import { ru } from "@/i18n/ru";
import { bankConsentsOf, grantBankConsent, type CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { dealRefSchema } from "./schemas";
import { requireRole, roleIn } from "./state";

/**
 * Согласие на передачу данных банку-партнёру (правовое исследование A.2, P3): отдельная отметка каждой стороны к сделке —
 * мастер до подписи оферты, покупатель перед оплатой. Хранит identity (GrantConsent BANK_TRANSFER, reference_id — id
 * сделки); оплата без согласий обеих сторон не создаёт операцию в журнале денег (payForDeal).
 */

/** Машинная причина отказа оплаты без согласий (AppError CONFLICT, details.reason). */
export const BANK_CONSENT_MISSING = "BANK_CONSENT_MISSING";

type Side = "CLIENT" | "EXECUTOR";

/**
 * Стороны сделки без блокировки строки: запрос к identity не идёт внутри транзакции. Несуществующая — «не найдено».
 */
export async function dealParties(dealId: string) {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { clientId: true, executorId: true, isDemo: true, status: true, executor: { select: { userId: true } } },
  });
  return deal ?? fail.notFound(ru.deal.errors.notFound);
}

type Parties = Awaited<ReturnType<typeof dealParties>>;

const userOf = (parties: Parties, side: Side) => (side === "CLIENT" ? parties.clientId : parties.executor.userId);

/** Какие стороны сделки дали согласие на передачу данных банку-партнёру (HasConsents). */
async function grantedSides(dealId: string, parties: Parties): Promise<Record<Side, boolean>> {
  const granted = await bankConsentsOf(dealId, [userOf(parties, "CLIENT"), userOf(parties, "EXECUTOR")]);
  return { CLIENT: granted.has(userOf(parties, "CLIENT")), EXECUTOR: granted.has(userOf(parties, "EXECUTOR")) };
}

/**
 * До списания: обе стороны дали согласие на передачу банку к этой сделке, иначе CONFLICT с `details.reason =
 * BANK_CONSENT_MISSING` и списком недостающих сторон; текст — покупателю, что отметить ему или чего ждать от мастера.
 */
export async function requireBankConsents(dealId: string, parties: Parties): Promise<void> {
  const sides = await grantedSides(dealId, parties);
  const missing = (["CLIENT", "EXECUTOR"] as const).filter((side) => !sides[side]);
  if (missing.length === 0) return;
  const t = ru.consent.errors;
  fail.conflict(missing.includes("CLIENT") ? t.bankMissingClient : t.bankMissingExecutor, { reason: BANK_CONSENT_MISSING, missing });
}

/** Состояние отметки для экрана сделки: своя и другой стороны; null — отметка не нужна (оператор, сделка не в CREATED). */
export type BankConsentState = { mine: boolean; other: boolean };

export async function bankConsentState(user: CurrentUser, dealId: string): Promise<BankConsentState | null> {
  const parties = await dealParties(dealId);
  const role = roleIn(user, parties);
  if (role === null || role === "OPERATOR" || parties.status !== "CREATED") return null;
  const sides = await grantedSides(dealId, parties);
  return { mine: sides[role], other: sides[role === "CLIENT" ? "EXECUTOR" : "CLIENT"] };
}

/** Отметка стороны: сделка и редакция текста согласия, которую человек видел на экране. */
export const bankConsentSchema = dealRefSchema.extend({ version: z.string().max(32) });

/**
 * Сторона сделки отмечает согласие на передачу данных банку-партнёру (до оплаты, пока сделка CREATED). Чужая сделка —
 * «не найдено», оператор — «не ваше действие»; показанная редакция не текущая — CONFLICT «текст обновился». Повтор — та
 * же запись в identity.
 */
export async function giveBankConsent(user: CurrentUser, raw: z.input<typeof bankConsentSchema>): Promise<void> {
  const { dealId, version } = parseInput(bankConsentSchema, raw);
  const parties = await dealParties(dealId);
  if (requireRole(user, parties) === "OPERATOR") fail.forbidden(ru.deal.errors.notYourAction);
  if (parties.status !== "CREATED") fail.conflict(ru.deal.errors.notAllowedNow);
  await grantBankConsent(dealId, version);
}
