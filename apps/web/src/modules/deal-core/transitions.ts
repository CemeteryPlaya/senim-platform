import type { DealStatus, DisputeOutcome } from "@/generated/prisma/enums";

/**
 * Статусная машина сделки (ТЗ п. 9, ADR-009 раздел 2) — данные: из какого статуса, в какой, кто, при каком условии.
 * Пары, которых нет в таблице, запрещены — в том числе любые перескоки. Пока открыт спор, запрещены все
 * переходы (решение спора не меняет статус само — статус двигают подтверждённые операции журнала).
 * Статус вторичен: CREATED → PAID_HOLD, ACCEPTED → SPLIT_PAYOUT и переходы в REFUNDED/SPLIT_PAYOUT по спору
 * выполняет обработчик итога операции журнала (SYSTEM), а не кнопка.
 */

export type Who = "CLIENT" | "EXECUTOR" | "OPERATOR" | "SYSTEM";

export const DEAL_STATUSES = ["CREATED", "PAID_HOLD", "IN_PROGRESS", "READY", "ACCEPTED", "SPLIT_PAYOUT", "CANCELLED", "REFUNDED"] as const satisfies readonly DealStatus[];
/** Статусы, в которых можно открыть спор. */
export const DISPUTABLE: readonly DealStatus[] = ["PAID_HOLD", "IN_PROGRESS", "READY"];

/** Всё, от чего зависят условия переходов. Деньги — факты журнала (payments.moneyFacts), не статус. */
export type DealContext = {
  /** Оферта подписана обеими сторонами (Deal.signedAt). */
  signed: boolean;
  /** Акт приёмки подписан (документ ACCEPTANCE_ACT в статусе SIGNED). */
  actSigned: boolean;
  openDispute: boolean;
  /** Итог последнего решённого спора; null — споров не было. */
  disputeOutcome: DisputeOutcome | null;
  money: {
    hold: "none" | "PENDING" | "SUCCEEDED" | "FAILED";
    exitRequested: boolean;
    payoutSettled: boolean;
    refundSettled: boolean;
  };
};

export type Refusal =
  | "notAllowedNow" // такого перехода нет в таблице
  | "notYourAction"
  | "disputeOpen"
  | "notSigned"
  | "holdNotSettled"
  | "holdPending"
  | "moneyLeaving"
  | "actNotSigned"
  | "payoutNotSettled"
  | "refundNotSettled";

export type DealTransition = {
  from: DealStatus;
  to: DealStatus;
  who: readonly Who[];
  /** Когда происходит — для людей (ADR, экран оператора). */
  when: string;
  guard: (c: DealContext) => Refusal | null;
};

const signedAndHeld = (c: DealContext): Refusal | null => (!c.signed ? "notSigned" : c.money.hold !== "SUCCEEDED" ? "holdNotSettled" : null);
const noHoldInFlight = (c: DealContext): Refusal | null => (c.money.hold === "PENDING" || c.money.hold === "SUCCEEDED" ? "holdPending" : null);
const moneyStays = (c: DealContext): Refusal | null => (c.money.exitRequested ? "moneyLeaving" : null);
const actSigned = (c: DealContext): Refusal | null => moneyStays(c) ?? (c.actSigned ? null : "actNotSigned");
const payoutSettled = (c: DealContext): Refusal | null => (c.money.payoutSettled ? null : "payoutNotSettled");
const refundSettled = (c: DealContext): Refusal | null => (c.money.refundSettled ? null : "refundNotSettled");
/** Деньги ушли из банка по решению спора — только с таким итогом спора. */
const byDispute = (outcome: DisputeOutcome, settled: (c: DealContext) => Refusal | null) => (c: DealContext) =>
  c.disputeOutcome !== outcome ? "notAllowedNow" : settled(c);

export const DEAL_TRANSITIONS: readonly DealTransition[] = [
  { from: "CREATED", to: "PAID_HOLD", who: ["SYSTEM"], when: "HOLD подтверждён (после подписи оферты обеими сторонами)", guard: signedAndHeld },
  { from: "CREATED", to: "CANCELLED", who: ["CLIENT", "EXECUTOR"], when: "отмена любой стороной до оплаты", guard: noHoldInFlight },
  { from: "PAID_HOLD", to: "IN_PROGRESS", who: ["EXECUTOR"], when: "мастер начал работу", guard: moneyStays },
  { from: "PAID_HOLD", to: "REFUNDED", who: ["SYSTEM"], when: "REFUND подтверждён: отмена покупателем или спор с полным возвратом", guard: refundSettled },
  { from: "PAID_HOLD", to: "SPLIT_PAYOUT", who: ["SYSTEM"], when: "спор: частичный раздел, операции подтверждены", guard: byDispute("PARTIAL_SPLIT", payoutSettled) },
  { from: "IN_PROGRESS", to: "READY", who: ["EXECUTOR"], when: "мастер сдал: фото обязательно, GPS — мягкая проверка", guard: moneyStays },
  { from: "IN_PROGRESS", to: "REFUNDED", who: ["SYSTEM"], when: "спор: полный возврат подтверждён", guard: byDispute("FULL_REFUND", refundSettled) },
  { from: "IN_PROGRESS", to: "SPLIT_PAYOUT", who: ["SYSTEM"], when: "спор: частичный раздел, операции подтверждены", guard: byDispute("PARTIAL_SPLIT", payoutSettled) },
  { from: "READY", to: "ACCEPTED", who: ["SYSTEM"], when: "покупатель подписал акт приёмки (хук documents)", guard: actSigned },
  { from: "READY", to: "REFUNDED", who: ["SYSTEM"], when: "спор: полный возврат подтверждён", guard: byDispute("FULL_REFUND", refundSettled) },
  { from: "READY", to: "SPLIT_PAYOUT", who: ["SYSTEM"], when: "спор: частичный раздел, операции подтверждены", guard: byDispute("PARTIAL_SPLIT", payoutSettled) },
  { from: "ACCEPTED", to: "SPLIT_PAYOUT", who: ["SYSTEM"], when: "SPLIT_MASTER и SPLIT_PLATFORM подтверждены", guard: payoutSettled },
];

export function findTransition(from: DealStatus, to: DealStatus): DealTransition | undefined {
  return DEAL_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/** null — переход разрешён; иначе причина отказа. Порядок проверок: таблица → кто → спор → условие. */
export function checkTransition(from: DealStatus, to: DealStatus, who: Who, ctx: DealContext): Refusal | null {
  const t = findTransition(from, to);
  if (!t) return "notAllowedNow";
  if (!t.who.includes(who)) return "notYourAction";
  if (ctx.openDispute) return "disputeOpen";
  return t.guard(ctx);
}
