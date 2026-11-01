import type { Prisma } from "@/generated/prisma/client";
import type { DealStatus, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, type Actor } from "@/modules/audit";
import type { CurrentUser } from "@/modules/identity";
import { lockDealRow, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import {
  DEAL_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  resolveTransition,
  STAGE_TRANSITIONS,
  type DealContext,
  type DealEvent,
  type PaymentContext,
  type PaymentEvent,
  type Refusal,
  type StageContext,
  type StageEvent,
  type Who,
} from "./transitions";

/** Сделка со всем, что нужно условиям переходов. Загружается только под блокировкой. */
const dealInclude = {
  stages: {
    orderBy: { order: "asc" },
    include: { payment: true, documents: { where: { kind: "STAGE_ACT" }, select: { id: true, status: true } } },
  },
} as const satisfies Prisma.DealInclude;

export type DealState = Prisma.DealGetPayload<{ include: typeof dealInclude }>;
export type StageState = DealState["stages"][number];

/**
 * Блокирует строку сделки до конца транзакции и читает актуальное состояние.
 * Все изменения сделки (этапы, оплаты, спор, вебхуки банка) идут по очереди — гонок между ними нет.
 */
export async function lockDeal(tx: Tx, dealId: string): Promise<DealState> {
  await lockDealRow(tx, dealId);
  const deal = await tx.deal.findUnique({ where: { id: dealId }, include: dealInclude });
  return deal ?? fail.notFound(ru.deal.errors.notFound);
}

export async function lockStage(tx: Tx, stageId: string): Promise<{ deal: DealState; stage: StageState }> {
  const ref = await tx.stage.findUnique({ where: { id: stageId }, select: { dealId: true } });
  if (!ref) return fail.notFound(ru.deal.errors.stageNotFound);
  const deal = await lockDeal(tx, ref.dealId);
  return { deal, stage: deal.stages.find((s) => s.id === stageId)! };
}

/** Кто пользователь в этой сделке. Чужая сделка — null (экран и сервис отвечают «не найдено»). */
export function roleIn(user: CurrentUser, deal: { clientId: string; executorId: string }): Who | null {
  if (user.role === "OPERATOR") return "OPERATOR";
  if (user.role === "CLIENT" && deal.clientId === user.id) return "CLIENT";
  if (user.role === "EXECUTOR" && user.executor?.id === deal.executorId) return "EXECUTOR";
  return null;
}

export function requireRole(user: CurrentUser, deal: { clientId: string; executorId: string }): Who {
  return roleIn(user, deal) ?? fail.notFound(ru.deal.errors.notFound);
}

export const scopeOf = (dealId: string) => `deal:${dealId}`;

export function refuse(reason: Refusal): never {
  if (reason === "notYourAction") return fail.forbidden(ru.deal.errors.notYourAction);
  return fail.conflict(ru.deal.errors[reason]);
}

// ─── Условия ─────────────────────────────────────────────────────────────────

export function previousDone(deal: DealState, stage: StageState): boolean {
  const prev = deal.stages.find((s) => s.order === stage.order - 1);
  return !prev || prev.status === "ACCEPTED" || prev.status === "CLOSED";
}

export const actSigned = (stage: StageState) => stage.documents.some((d) => d.status === "SIGNED");

export function stageContext(deal: DealState, stage: StageState, now = new Date()): StageContext {
  return {
    dealStatus: deal.status,
    previousDone: previousDone(deal, stage),
    paymentDue: stage.paymentDue,
    hasPayment: stage.payment !== null,
    paymentStatus: stage.payment?.status ?? null,
    actSigned: actSigned(stage),
    autoAcceptDue: !!stage.autoAcceptAt && stage.autoAcceptAt <= now,
  };
}

export function paymentContext(deal: DealState, stage: StageState): PaymentContext {
  return {
    mode: deal.paymentMode,
    dealStatus: deal.status,
    stageStatus: stage.status,
    paymentDue: stage.paymentDue,
    previousDone: previousDone(deal, stage),
  };
}

// ─── Переходы: таблица → условное обновление → журнал ────────────────────────

type Audit = { action: string; meta?: Prisma.InputJsonValue };

type Move = {
  /** Результат updateMany с ожидаемым статусом: не одна строка — статус уже сменили, CONFLICT. */
  updated: { count: number };
  entity: { type: "deal" | "stage"; id: string };
  dealId: string;
  /** Ключ статуса в журнале: «status» — сделка или этап, «payment» — оплата этапа. */
  field: "status" | "payment";
  from: string;
  to: string;
  actor: Actor;
  action: string;
  meta?: Prisma.InputJsonValue;
};

/** Общий хвост перехода: проверка условного обновления и запись в журнал в той же транзакции. */
async function commitMove(tx: Tx, m: Move): Promise<void> {
  expectOneUpdated(m.updated, ru.deal.errors.notAllowedNow);
  await recordAudit(tx, {
    actor: m.actor,
    action: m.action,
    entity: m.entity,
    scope: scopeOf(m.dealId),
    before: { [m.field]: m.from },
    after: { [m.field]: m.to },
    meta: m.meta,
  });
}

/** Журнал этапа: порядок, название и сумма этапа (или его оплаты) вместе с полями вызывающего. */
function stageAudit(deal: DealState, stage: StageState, amount: number, q: { actor: Actor; audit: Audit }) {
  return {
    entity: { type: "stage", id: stage.id } as const,
    dealId: deal.id,
    actor: q.actor,
    action: q.audit.action,
    meta: { order: stage.order, title: stage.title, amount, ...(q.audit.meta as object | undefined) },
  };
}

/**
 * Переход сделки по таблице. updateMany с ожидаемым статусом + expectOneUpdated:
 * если статус уже сменил кто-то другой, транзакция откатывается с CONFLICT.
 */
export async function moveDeal(
  tx: Tx,
  deal: DealState,
  q: { event: DealEvent; who: Who; actor: Actor; audit: Audit; ctx?: Partial<DealContext>; data?: Prisma.DealUpdateManyMutationInput },
): Promise<DealStatus> {
  const ctx: DealContext = {
    mode: deal.paymentMode,
    fullyFunded: false,
    allStagesClosed: deal.stages.every((s) => s.status === "CLOSED"),
    ...q.ctx,
  };
  const r = resolveTransition(DEAL_TRANSITIONS, { event: q.event, from: deal.status, who: q.who, ctx });
  if (!r.ok) return refuse(r.reason);
  const from = deal.status;
  await commitMove(tx, {
    updated: await tx.deal.updateMany({ where: { id: deal.id, status: from }, data: { ...q.data, status: r.to } }),
    entity: { type: "deal", id: deal.id },
    dealId: deal.id,
    field: "status",
    from,
    to: r.to,
    actor: q.actor,
    action: q.audit.action,
    meta: q.audit.meta,
  });
  deal.status = r.to;
  return r.to;
}

export async function moveStage(
  tx: Tx,
  deal: DealState,
  stage: StageState,
  q: { event: StageEvent; who: Who; actor: Actor; audit: Audit; data?: Prisma.StageUpdateManyMutationInput; now?: Date },
): Promise<StageStatus> {
  const r = resolveTransition(STAGE_TRANSITIONS, { event: q.event, from: stage.status, who: q.who, ctx: stageContext(deal, stage, q.now) });
  if (!r.ok) return refuse(r.reason);
  const from = stage.status;
  await commitMove(tx, {
    updated: await tx.stage.updateMany({ where: { id: stage.id, status: from }, data: { ...q.data, status: r.to } }),
    ...stageAudit(deal, stage, stage.amount, q),
    field: "status",
    from,
    to: r.to,
  });
  stage.status = r.to;
  return r.to;
}

export async function movePayment(
  tx: Tx,
  deal: DealState,
  stage: StageState,
  q: { event: PaymentEvent; who: Who; actor: Actor; audit: Audit; data?: Prisma.StagePaymentUpdateManyMutationInput },
): Promise<StagePaymentStatus> {
  const payment = stage.payment;
  if (!payment) return refuse("notPayableYet");
  const r = resolveTransition(PAYMENT_TRANSITIONS, { event: q.event, from: payment.status, who: q.who, ctx: paymentContext(deal, stage) });
  if (!r.ok) return refuse(r.reason);
  const from = payment.status;
  await commitMove(tx, {
    updated: await tx.stagePayment.updateMany({ where: { id: payment.id, status: from }, data: { ...q.data, status: r.to } }),
    ...stageAudit(deal, stage, payment.amount, q),
    field: "payment",
    from,
    to: r.to,
  });
  payment.status = r.to;
  return r.to;
}

/** Проверка перехода без изменения (для «попробовать закрыть этап»). */
export function canMoveStage(deal: DealState, stage: StageState, event: StageEvent, who: Who, now?: Date): boolean {
  return resolveTransition(STAGE_TRANSITIONS, { event, from: stage.status, who, ctx: stageContext(deal, stage, now) }).ok;
}
