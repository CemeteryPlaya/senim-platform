import type { DealStatus } from "@/generated/prisma/enums";
import { dealProgressView } from "@/features/deal-progress/deal-progress";
import { ru } from "@/i18n/ru";
import type { StepState } from "@/kit";
import type { NextAction, NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";

/**
 * Сделка покупателя коротко — общее для главной, списка «Сделки» и карточки сделки (чистые функции без React и базы):
 * ход сделки, тон и текст плашки статуса, строка денег. Одно правило в одном месте: главная, список и карточка говорят
 * одно и то же.
 */

const s = ru.app.buyer.home.deal;

/** Исход решённого спора (последний спор сделки, `Dispute.outcome`). */
export type DisputeOutcome = "CONTINUE" | "FULL_REFUND" | "PARTIAL_SPLIT";

/** Шаги сделки по-человечески; до подписи оферты первый шаг называется шире — «Оферта и оплата». */
function stepNames(action: NextAction | null): readonly string[] {
  return action === "signContract" || action === "waitContractSignature" ? [s.offerStep, ...s.steps.slice(1)] : s.steps;
}

export type DealProgress =
  | { kind: "steps"; /** Сколько шагов пройдено: номер текущего шага минус один; равен `total`, когда пройдены все. */ done: number; total: number }
  | { kind: "stopped"; reason: "dispute" | "cancelled" | "refunded" };

/** Ход сделки для компактной карточки: сколько шагов из пяти пройдено; спор, отмена и возврат — «остановлено». */
export function dealProgress(status: DealStatus, hasOpenDispute: boolean): DealProgress {
  const view = dealProgressView(status, hasOpenDispute);
  if (view.kind === "banner") return { kind: "stopped", reason: view.tone };
  if (view.muted) return { kind: "stopped", reason: "dispute" };
  return { kind: "steps", done: view.current, total: s.steps.length };
}

/** Строка хода компактной карточки: «Шаг 2 из 5: Изготовление» или «Все шаги пройдены»; остановленной — `null`. */
export function progressCaption(progress: DealProgress, action: NextAction | null): string | null {
  if (progress.kind === "stopped") return null;
  if (progress.done >= progress.total) return s.allDone;
  return s.caption(progress.done + 1, progress.total, stepNames(action)[progress.done] ?? "");
}

/** Подпись остановленного хода: спор, отмена, возврат. */
export const stoppedLabel = (reason: Extract<DealProgress, { kind: "stopped" }>["reason"]): string => s.stopped[reason];

export type DealStepsView =
  | { kind: "steps"; items: { label: string; state: StepState }[]; caption: string; done: number; total: number }
  | { kind: "stopped"; label: string };

/**
 * Полный ход сделки для карточки: пять шагов с отметками и строка «Шаг N из 5»; спор, отмена и возврат — строка вместо
 * шкалы. Спор, решённый разделом или возвратом, тоже останавливает шкалу: «все шаги пройдены» было бы неправдой.
 */
export function dealStepsView(status: DealStatus, hasOpenDispute: boolean, action: NextAction | null, outcome: DisputeOutcome | null = null): DealStepsView {
  const card = ru.app.deal.card.steps;
  if (!hasOpenDispute && outcome === "PARTIAL_SPLIT") return { kind: "stopped", label: card.disputeSplit };
  if (!hasOpenDispute && outcome === "FULL_REFUND" && status !== "REFUNDED") return { kind: "stopped", label: card.disputeRefund };
  const progress = dealProgress(status, hasOpenDispute);
  if (progress.kind === "stopped") return { kind: "stopped", label: stoppedLabel(progress.reason) };
  const items = stepNames(action).map((label, index) => {
    const state: StepState = index < progress.done ? "done" : index === progress.done ? "current" : "todo";
    return { label, state };
  });
  return { kind: "steps", items, caption: progressCaption(progress, action) ?? "", done: progress.done, total: progress.total };
}

export type DealTone = "accent" | "neutral" | "warn";

/**
 * Тон плашки статуса сделки. Зелёный — только когда деньги уже в банке под защитой или работа идёт к концу (оплачено);
 * сделка, которая ждёт оплаты, — нейтральная; ждёт моего действия или спор — «внимание»; отмена и возврат — нейтральные.
 * Не «внимание»: отзыв (сделка завершена, отзыв по желанию) и оплата, закрытая до согласия мастера для банка
 * (`payWaitsMaster`: от покупателя ничего не зависит).
 */
export function dealTone(deal: {
  status: DealStatus;
  hasOpenDispute: boolean;
  next: Pick<NextStep, "mine"> & Partial<Pick<NextStep, "action">> | null;
  payWaitsMaster?: boolean;
}): DealTone {
  const mine = deal.next?.mine === true && deal.next.action !== "leaveReview" && !deal.payWaitsMaster;
  if (deal.hasOpenDispute || mine) return "warn";
  if (deal.status === "CANCELLED" || deal.status === "REFUNDED" || deal.status === "CREATED") return "neutral";
  return "accent";
}

/** Текст плашки статуса: открытый спор важнее статуса. */
export function dealStatusText(status: DealStatus, hasOpenDispute: boolean): string {
  return hasOpenDispute ? ru.app.deal.status.dispute : ru.app.deal.status[status];
}

/** Оплата закрыта: шаг покупателя — оплата, а мастер не дал согласие на передачу данных банку. */
export function payWaitsMaster(next: Pick<NextStep, "action" | "mine"> | null, bank: { other: boolean } | null): boolean {
  return next?.action === "pay" && next.mine && bank !== null && !bank.other;
}

export type DealMoneyLine = { amountTiyn: bigint | null; label: string };

/**
 * Строка денег сделки в списке и на главной — только из журнала (`moneyBlock`): до оплаты — смета «к оплате»; в банке
 * (под защитой или спор) — остаток в банке; выплата — без суммы (выплату мастеру с гарантией покупателю не показываем);
 * возврат — сумма возврата «вернулись вам».
 */
export function dealMoneyLine(m: MoneyBlock, estimate: { totalTiyn: bigint }): DealMoneyLine {
  const l = ru.app.deal.line;
  switch (m.kind) {
    case "awaiting":
      return { amountTiyn: estimate.totalTiyn, label: l.toPay };
    case "protected":
      return { amountTiyn: m.amountTiyn, label: l.inBank };
    case "frozen":
      return { amountTiyn: m.bankBalanceTiyn, label: l.inBank };
    case "completed":
      return { amountTiyn: null, label: m.settled ? l.payoutDone : l.payoutPending };
    case "refunded":
      return { amountTiyn: m.amountTiyn, label: m.settled ? l.refundDone : l.refundPending };
  }
}
