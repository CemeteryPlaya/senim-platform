import type { DealStatus, MoneyTransactionType } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { randomToken } from "@/platform/crypto";
import { db, transaction } from "@/platform/db";
import { fail } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { parseInput } from "@/platform/validation";
import { dealRefSchema } from "./schemas";
import { roleIn, scopeOf } from "./state";

/**
 * Публичный read-only доступ к сделке (ТЗ п. 8, ADR-009 п. 10) — фундамент витрины Фазы 2.
 * Витрина видна только при флаге publicShowcase, по согласию ОБЕИХ сторон и только для завершённой сделки.
 * Проекция обезличена: ни имён, ни телефонов, ни адреса, ни ИИН/БИН и IBAN, ни номеров операций банка.
 */

/** Что видит посетитель витрины. Поля перечислены явно: новое поле сделки само сюда не попадёт. */
export type PublicDealView = {
  publicId: string;
  title: string;
  status: DealStatus;
  priceTiyn: bigint;
  protectionTiyn: bigint;
  payoutTiyn: bigint;
  timeline: { paidAt: Date | null; startedAt: Date | null; readyAt: Date | null; acceptedAt: Date | null; completedAt: Date | null };
  readyWithinRadius: boolean | null;
  money: { type: MoneyTransactionType; amountTiyn: bigint; settledAt: Date | null }[];
  deliveryPhotoIds: string[];
};

type PublicSource = {
  publicId: string | null;
  title: string;
  status: DealStatus;
  priceTiyn: bigint;
  protectionTiyn: bigint;
  payoutTiyn: bigint;
  paidAt: Date | null;
  startedAt: Date | null;
  readyAt: Date | null;
  acceptedAt: Date | null;
  completedAt: Date | null;
  readyWithinRadius: boolean | null;
  publicConsents: { party: "CLIENT" | "EXECUTOR"; revokedAt: Date | null }[];
  transactions: { type: MoneyTransactionType; amountTiyn: bigint; status: string; settledAt: Date | null }[];
  deliveryPhotos: { id: string }[];
};

/** Обе стороны дали согласие и не отозвали его. */
export function bothConsented(consents: PublicSource["publicConsents"]): boolean {
  const active = new Set(consents.filter((c) => c.revokedAt === null).map((c) => c.party));
  return active.has("CLIENT") && active.has("EXECUTOR");
}

/** Чистая проекция: null — показывать нельзя (нет id, нет обоих согласий, сделка не завершена). */
export function projectPublicDeal(deal: PublicSource): PublicDealView | null {
  if (!deal.publicId || deal.status !== "SPLIT_PAYOUT" || !bothConsented(deal.publicConsents)) return null;
  return {
    publicId: deal.publicId,
    title: deal.title,
    status: deal.status,
    priceTiyn: deal.priceTiyn,
    protectionTiyn: deal.protectionTiyn,
    payoutTiyn: deal.payoutTiyn,
    timeline: { paidAt: deal.paidAt, startedAt: deal.startedAt, readyAt: deal.readyAt, acceptedAt: deal.acceptedAt, completedAt: deal.completedAt },
    readyWithinRadius: deal.readyWithinRadius,
    money: deal.transactions.filter((t) => t.status === "SUCCEEDED").map((t) => ({ type: t.type, amountTiyn: t.amountTiyn, settledAt: t.settledAt })),
    deliveryPhotoIds: deal.deliveryPhotos.map((p) => p.id),
  };
}

const PUBLIC_SELECT = {
  publicId: true,
  title: true,
  status: true,
  priceTiyn: true,
  protectionTiyn: true,
  payoutTiyn: true,
  paidAt: true,
  startedAt: true,
  readyAt: true,
  acceptedAt: true,
  completedAt: true,
  readyWithinRadius: true,
  publicConsents: { select: { party: true, revokedAt: true } },
  transactions: { orderBy: { seq: "asc" }, select: { type: true, amountTiyn: true, status: true, settledAt: true } },
  deliveryPhotos: { orderBy: { sortOrder: "asc" }, select: { id: true } },
} as const;

/** Витрина по публичному идентификатору; null — 404 (флаг выключен, нет согласий, нет такой). */
export async function getPublicDealView(publicId: string): Promise<PublicDealView | null> {
  if (!isEnabled("publicShowcase")) return null;
  const deal = await db.deal.findUnique({ where: { publicId }, select: PUBLIC_SELECT });
  return deal ? projectPublicDeal(deal) : null;
}

/** Сторона сделки соглашается на обезличенную витрину. Когда согласны обе — сделке выдаётся publicId. */
export async function grantPublicConsent(user: CurrentUser, input: unknown): Promise<{ publicId: string | null }> {
  const { dealId } = parseInput(dealRefSchema, input);
  return transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { clientId: true, executorId: true, publicId: true } });
    const party = deal ? roleIn(user, deal) : null;
    if (!deal || !party) return fail.notFound(ru.deal.errors.notFound);
    if (party === "OPERATOR") return fail.forbidden(ru.deal.errors.notYourAction);
    await tx.dealPublicConsent.upsert({
      where: { dealId_party: { dealId, party } },
      create: { dealId, party, userId: user.id },
      update: { revokedAt: null, grantedAt: new Date(), userId: user.id },
    });
    const consents = await tx.dealPublicConsent.findMany({ where: { dealId }, select: { party: true, revokedAt: true } });
    const publicId = deal.publicId ?? (bothConsented(consents) ? randomToken(12) : null);
    if (publicId && !deal.publicId) await tx.deal.update({ where: { id: dealId }, data: { publicId } });
    await recordAudit(tx, { actor: actorOf(user), action: "deal.public.consent_granted", entity: { type: "deal", id: dealId }, scope: scopeOf(dealId), meta: { party } });
    return { publicId };
  });
}

/** Отзыв согласия: витрина сразу перестаёт открываться (publicId остаётся — ссылка просто ведёт в 404). */
export async function revokePublicConsent(user: CurrentUser, input: unknown): Promise<void> {
  const { dealId } = parseInput(dealRefSchema, input);
  await transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { clientId: true, executorId: true } });
    const party = deal ? roleIn(user, deal) : null;
    if (!deal || !party) return fail.notFound(ru.deal.errors.notFound);
    if (party === "OPERATOR") return fail.forbidden(ru.deal.errors.notYourAction);
    await tx.dealPublicConsent.updateMany({ where: { dealId, party, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { actor: actorOf(user), action: "deal.public.consent_revoked", entity: { type: "deal", id: dealId }, scope: scopeOf(dealId), meta: { party } });
  });
}
