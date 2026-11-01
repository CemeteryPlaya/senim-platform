import type { DealStatus, PaymentDue, PaymentMode, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";

/**
 * Статусные машины сделки, этапа и оплаты этапа (ADR-002) — данными, а не ветками кода.
 * Строка таблицы: событие, из каких статусов, в какой, кто может, условие.
 * Сервис только находит строку (resolveTransition) и делает условное обновление в БД.
 */

export type Who = "CLIENT" | "EXECUTOR" | "OPERATOR" | "SYSTEM";

/** Почему переход невозможен. Тексты — ru.deal.errors[<причина>]. */
export type Refusal =
  | "notAllowedNow"
  | "notYourAction"
  | "notFullyFunded"
  | "stagesNotClosed"
  | "dealNotActive"
  | "previousStageOpen"
  | "advanceNotConfirmed"
  | "autoAcceptNotDue"
  | "actNotSigned"
  | "paymentNotConfirmed"
  | "escrowNoMarks"
  | "manualNoRelease"
  | "notPayableYet";

type Guard<C> = (ctx: C) => Refusal | null;

export type Transition<S extends string, E extends string, C> = {
  readonly event: E;
  readonly from: readonly S[];
  readonly to: S;
  readonly who: readonly Who[];
  readonly guard?: Guard<C>;
};

/** Первое невыполненное условие или null. */
const all =
  <C>(...guards: Guard<C>[]): Guard<C> =>
  (ctx) => {
    for (const g of guards) {
      const r = g(ctx);
      if (r) return r;
    }
    return null;
  };

// ─── Сделка ──────────────────────────────────────────────────────────────────

export type DealContext = { mode: PaymentMode; fullyFunded: boolean; allStagesClosed: boolean };
export type DealEvent =
  | "contractSigned"
  | "depositReceived"
  | "cancel"
  | "openDispute"
  | "resolveContinue"
  | "resolveTerminate"
  | "complete";

const isManual = (mode: PaymentMode) => mode === "MANUAL";

export const DEAL_TRANSITIONS = [
  // manual: после подписи сразу работы; эскроу: сначала пополнение счёта
  { event: "contractSigned", from: ["AWAITING_SIGNATURES"], to: "IN_PROGRESS", who: ["SYSTEM"], guard: (c) => (isManual(c.mode) ? null : "notAllowedNow") },
  { event: "contractSigned", from: ["AWAITING_SIGNATURES"], to: "AWAITING_DEPOSIT", who: ["SYSTEM"], guard: (c) => (isManual(c.mode) ? "notAllowedNow" : null) },
  { event: "depositReceived", from: ["AWAITING_DEPOSIT"], to: "IN_PROGRESS", who: ["SYSTEM"], guard: (c) => (c.fullyFunded ? null : "notFullyFunded") },
  { event: "cancel", from: ["AWAITING_SIGNATURES", "AWAITING_DEPOSIT"], to: "CANCELLED", who: ["CLIENT", "EXECUTOR"] },
  { event: "openDispute", from: ["IN_PROGRESS"], to: "DISPUTE", who: ["CLIENT", "EXECUTOR"] },
  { event: "resolveContinue", from: ["DISPUTE"], to: "IN_PROGRESS", who: ["OPERATOR"] },
  { event: "resolveTerminate", from: ["DISPUTE"], to: "TERMINATED", who: ["OPERATOR"] },
  { event: "complete", from: ["IN_PROGRESS"], to: "COMPLETED", who: ["SYSTEM"], guard: (c) => (c.allStagesClosed ? null : "stagesNotClosed") },
] as const satisfies readonly Transition<DealStatus, DealEvent, DealContext>[];

// ─── Этап ────────────────────────────────────────────────────────────────────

export type StageContext = {
  dealStatus: DealStatus;
  /** Предыдущий этап принят или закрыт (для первого этапа — true). */
  previousDone: boolean;
  paymentDue: PaymentDue;
  /** У этапа есть сумма (и StagePayment). */
  hasPayment: boolean;
  paymentStatus: StagePaymentStatus | null;
  /** Акт этапа подписан обеими сторонами. */
  actSigned: boolean;
  /** Срок автоприёмки вышел. */
  autoAcceptDue: boolean;
};
export type StageEvent =
  | "start"
  | "submit"
  | "requestRework"
  | "accept"
  | "autoAccept"
  | "close"
  | "disputeFavorExecutor"
  | "disputeFavorClient";

const dealActive: Guard<StageContext> = (c) => (c.dealStatus === "IN_PROGRESS" ? null : "dealNotActive");
const dealInDispute: Guard<StageContext> = (c) => (c.dealStatus === "DISPUTE" ? null : "notAllowedNow");
const paymentSettled = (c: { hasPayment: boolean; paymentStatus: StagePaymentStatus | null }) =>
  !c.hasPayment || c.paymentStatus === "CONFIRMED";

export const STAGE_TRANSITIONS = [
  {
    event: "start",
    from: ["PENDING"],
    to: "IN_PROGRESS",
    who: ["EXECUTOR"],
    guard: all<StageContext>(
      dealActive,
      (c) => (c.previousDone ? null : "previousStageOpen"),
      (c) => (c.paymentDue === "ON_START" && !paymentSettled(c) ? "advanceNotConfirmed" : null),
    ),
  },
  { event: "submit", from: ["IN_PROGRESS", "REWORK"], to: "SUBMITTED", who: ["EXECUTOR"], guard: dealActive },
  { event: "requestRework", from: ["SUBMITTED"], to: "REWORK", who: ["CLIENT"], guard: dealActive },
  { event: "accept", from: ["SUBMITTED"], to: "ACCEPTED", who: ["CLIENT"], guard: dealActive },
  {
    event: "autoAccept",
    from: ["SUBMITTED"],
    to: "ACCEPTED",
    who: ["SYSTEM"],
    guard: all<StageContext>(dealActive, (c) => (c.autoAcceptDue ? null : "autoAcceptNotDue")),
  },
  {
    event: "close",
    from: ["ACCEPTED"],
    to: "CLOSED",
    who: ["SYSTEM"],
    guard: (c) => (!c.actSigned ? "actNotSigned" : paymentSettled(c) ? null : "paymentNotConfirmed"),
  },
  // Решения по спору: оператор двигает этап, о котором спор.
  { event: "disputeFavorExecutor", from: ["IN_PROGRESS", "SUBMITTED", "REWORK"], to: "ACCEPTED", who: ["OPERATOR"], guard: dealInDispute },
  { event: "disputeFavorClient", from: ["IN_PROGRESS", "SUBMITTED"], to: "REWORK", who: ["OPERATOR"], guard: dealInDispute },
] as const satisfies readonly Transition<StageStatus, StageEvent, StageContext>[];

// ─── Оплата этапа ────────────────────────────────────────────────────────────

export type PaymentContext = {
  mode: PaymentMode;
  dealStatus: DealStatus;
  stageStatus: StageStatus;
  paymentDue: PaymentDue;
  previousDone: boolean;
};
export type PaymentEvent = "markPaid" | "confirm" | "release";

/**
 * Когда оплата этапа становится к оплате: аванс (ON_START) — как только этап может начаться
 * (сделка в работе, предыдущий этап принят); после приёмки (ON_ACCEPTANCE) — после ACCEPTED.
 * Тот же момент в эскроу запускает раскрытие транша.
 */
export function isPayable(c: Pick<PaymentContext, "dealStatus" | "stageStatus" | "paymentDue" | "previousDone">): boolean {
  if (c.dealStatus !== "IN_PROGRESS" && c.dealStatus !== "DISPUTE") return false;
  return c.paymentDue === "ON_START" ? c.previousDone : c.stageStatus === "ACCEPTED" || c.stageStatus === "CLOSED";
}

const manualOnly: Guard<PaymentContext> = (c) => (isManual(c.mode) ? null : "escrowNoMarks");

export const PAYMENT_TRANSITIONS = [
  { event: "markPaid", from: ["DUE"], to: "MARKED_PAID", who: ["CLIENT"], guard: all<PaymentContext>(manualOnly, (c) => (isPayable(c) ? null : "notPayableYet")) },
  { event: "confirm", from: ["MARKED_PAID"], to: "CONFIRMED", who: ["EXECUTOR"], guard: manualOnly },
  { event: "release", from: ["DUE"], to: "CONFIRMED", who: ["SYSTEM"], guard: (c) => (isManual(c.mode) ? "manualNoRelease" : null) },
] as const satisfies readonly Transition<StagePaymentStatus, PaymentEvent, PaymentContext>[];

// ─── Поиск перехода ──────────────────────────────────────────────────────────

export type Resolution<S> = { ok: true; to: S } | { ok: false; reason: Refusal };

/**
 * Находит переход по событию и текущему статусу. Если строк несколько (развилка по режиму),
 * берётся первая, чьё условие выполнено; иначе — причина отказа первой подходящей.
 */
export function resolveTransition<S extends string, E extends string, C>(
  table: readonly Transition<S, E, C>[],
  q: { event: E; from: S; who: Who; ctx: C },
): Resolution<S> {
  const rows = table.filter((t) => t.event === q.event && t.from.includes(q.from));
  if (rows.length === 0) return { ok: false, reason: "notAllowedNow" };
  const permitted = rows.filter((t) => t.who.includes(q.who));
  if (permitted.length === 0) return { ok: false, reason: "notYourAction" };
  const refusals: Refusal[] = [];
  for (const row of permitted) {
    const refusal = row.guard?.(q.ctx);
    if (!refusal) return { ok: true, to: row.to };
    refusals.push(refusal);
  }
  return { ok: false, reason: refusals[0] };
}
