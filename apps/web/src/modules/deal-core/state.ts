import type { Prisma } from "@/generated/prisma/client";
import type { DealStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, type Actor } from "@/modules/audit";
import type { CurrentUser } from "@/modules/identity";
import { moneyFactsOf, type MoneyFacts } from "@/modules/payments";
import { lockDealRow, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { checkTransition, type DealContext, type Refusal, type Who } from "./transitions";

/** Сделка со всем, что нужно условиям переходов. Загружается только под блокировкой строки. */
const dealSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  clientId: true,
  executorId: true,
  requestId: true,
  paymentProvider: true,
  isDemo: true,
  signedAt: true,
  priceTiyn: true,
  buyerTotalTiyn: true,
  payoutTiyn: true,
  platformIncomeTiyn: true,
  executor: { select: { userId: true } },
  disputes: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, outcome: true, openedInStatus: true } },
  documents: { where: { kind: "ACCEPTANCE_ACT", status: "SIGNED" }, select: { id: true } },
} as const satisfies Prisma.DealSelect;

export type DealRow = Prisma.DealGetPayload<{ select: typeof dealSelect }>;
export type DealState = DealRow & { money: MoneyFacts };

/**
 * Блокирует строку сделки до конца транзакции (SELECT … FOR UPDATE) и читает актуальное состояние
 * вместе с фактами журнала денег. Все изменения сделки — действия сторон, итоги операций банка,
 * решения оператора — идут по очереди: двойной клик и вебхук посреди действия не дают двойного эффекта.
 */
export async function lockDeal(tx: Tx, dealId: string): Promise<DealState> {
  if (!(await lockDealRow(tx, dealId))) return fail.notFound(ru.deal.errors.notFound);
  const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, select: dealSelect });
  return { ...deal, money: await moneyFactsOf(tx, dealId) };
}

export function contextOf(deal: DealState): DealContext {
  const last = deal.disputes[0];
  return {
    signed: deal.signedAt !== null,
    actSigned: deal.documents.length > 0,
    openDispute: last?.status === "OPEN",
    disputeOutcome: last?.status === "RESOLVED" ? last.outcome : null,
    money: deal.money,
  };
}

/** Кем человек был в сделке — по активной роли (ADR-004). Чужая сделка — null. */
export type Viewer = Exclude<Who, "SYSTEM">;

export function roleIn(user: CurrentUser, deal: { clientId: string; executorId: string }): Viewer | null {
  if (user.role === "OPERATOR") return "OPERATOR";
  if (user.role === "CLIENT" && deal.clientId === user.id) return "CLIENT";
  if (user.role === "EXECUTOR" && user.executor?.id === deal.executorId) return "EXECUTOR";
  return null;
}

/** Сторона сделки или оператор; чужая сделка — «не найдено» (IDOR: не выдаём, что сделка существует). */
export function requireRole(user: CurrentUser, deal: { clientId: string; executorId: string }): Viewer {
  return roleIn(user, deal) ?? fail.notFound(ru.deal.errors.notFound);
}

/** Действие только этой стороны: чужая сделка — «не найдено», другая сторона или оператор — «не ваше действие». */
export function requireParty(user: CurrentUser, deal: { clientId: string; executorId: string }, party: "CLIENT" | "EXECUTOR"): void {
  if (requireRole(user, deal) !== party) fail.forbidden(ru.deal.errors.notYourAction);
}

export const scopeOf = (dealId: string) => `deal:${dealId}`;

export function refuse(reason: Refusal): never {
  if (reason === "notYourAction") return fail.forbidden(ru.deal.errors.notYourAction);
  return fail.conflict(ru.deal.errors[reason]);
}

export function canMove(deal: DealState, to: DealStatus, who: Who): boolean {
  return checkTransition(deal.status, to, who, contextOf(deal)) === null;
}

export type Move = {
  to: DealStatus;
  who: Who;
  actor: Actor;
  /** Глагол аудита: «deal.started». */
  action: string;
  data?: Omit<Prisma.DealUpdateManyMutationInput, "status">;
  meta?: Prisma.InputJsonValue;
};

/**
 * Переход по таблице: проверка (кто, спор, условие) → условное обновление «where status = from» →
 * аудит в той же транзакции. Чужой параллельный переход — CONFLICT (expectOneUpdated).
 */
export async function moveDeal(tx: Tx, deal: DealState, move: Move): Promise<void> {
  const from = deal.status;
  const refusal = checkTransition(from, move.to, move.who, contextOf(deal));
  if (refusal) refuse(refusal);
  const result = await tx.deal.updateMany({ where: { id: deal.id, status: from }, data: { ...move.data, status: move.to } });
  expectOneUpdated(result);
  deal.status = move.to;
  await recordAudit(tx, {
    actor: move.actor,
    action: move.action,
    entity: { type: "deal", id: deal.id },
    scope: scopeOf(deal.id),
    before: { status: from },
    after: { status: move.to },
    meta: move.meta,
  });
}
