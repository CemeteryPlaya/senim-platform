import type { DealStatus } from "@/generated/prisma/enums";
import { dealProgressView } from "@/features/deal-progress/deal-progress";
import { ru } from "@/i18n/ru";
import type { StepState } from "@/kit";
import type { NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";

/**
 * Сделка покупателя коротко — общее для главной, списка «Сделки» и карточки сделки (чистые функции без React и базы):
 * ход сделки, тон и текст плашки статуса, строка денег. Одно правило в одном месте: главная, список и карточка говорят
 * одно и то же.
 */

const s = ru.app.buyer.home.deal;

/** Подписи пяти шагов хода сделки — одни и те же в строке «Шаг N из 5» (список, главная) и на шкале карточки. */
const stepNames = (): readonly string[] => ru.app.deal.steps;

/** Исход решённого спора (последний спор сделки, `Dispute.outcome`). */
export type DisputeOutcome = "CONTINUE" | "FULL_REFUND" | "PARTIAL_SPLIT";

export type DealProgress =
  | { kind: "steps"; /** Сколько шагов пройдено: номер текущего шага минус один; равен `total`, когда пройдены все. */ done: number; total: number }
  | { kind: "stopped"; reason: "dispute" | "cancelled" | "refunded" };

/** Ход сделки для компактной карточки: сколько шагов из пяти пройдено; спор, отмена и возврат — «остановлено». */
export function dealProgress(status: DealStatus, hasOpenDispute: boolean): DealProgress {
  const view = dealProgressView(status, hasOpenDispute);
  if (view.kind === "banner") return { kind: "stopped", reason: view.tone };
  if (view.muted) return { kind: "stopped", reason: "dispute" };
  return { kind: "steps", done: view.current, total: stepNames().length };
}

/** Строка хода компактной карточки: «Шаг 2 из 5: Изготовление» или «Все шаги пройдены»; остановленной — `null`. */
export function progressCaption(progress: DealProgress): string | null {
  if (progress.kind === "stopped") return null;
  if (progress.done >= progress.total) return s.allDone;
  return s.caption(progress.done + 1, progress.total, stepNames()[progress.done] ?? "");
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
export function dealStepsView(status: DealStatus, hasOpenDispute: boolean, outcome: DisputeOutcome | null = null): DealStepsView {
  const card = ru.app.deal.card.steps;
  if (!hasOpenDispute && outcome === "PARTIAL_SPLIT") return { kind: "stopped", label: card.disputeSplit };
  if (!hasOpenDispute && outcome === "FULL_REFUND" && status !== "REFUNDED") return { kind: "stopped", label: card.disputeRefund };
  const progress = dealProgress(status, hasOpenDispute);
  if (progress.kind === "stopped") return { kind: "stopped", label: stoppedLabel(progress.reason) };
  const items = stepNames().map((label, index) => {
    const state: StepState = index < progress.done ? "done" : index === progress.done ? "current" : "todo";
    return { label, state };
  });
  return { kind: "steps", items, caption: progressCaption(progress) ?? "", done: progress.done, total: progress.total };
}

export type DealTone = "accent" | "neutral" | "warn";

/** Оплата оформлена, поступления ещё нет: перевод по реквизитам (`transfer`), онлайн-оплата у банка (`online`). */
export type PaymentWait = "transfer" | "online";

/**
 * Идёт ли ожидание оплаты (журнал денег: операция оплаты в обработке, сделка ещё `CREATED`) и какое: ручной провайдер —
 * ждём перевод покупателя, иначе банк обрабатывает оплату. Иначе — `null`.
 */
export function paymentWait(deal: { status: DealStatus; money: MoneyBlock; paymentProvider: string }): PaymentWait | null {
  if (deal.status !== "CREATED" || deal.money.kind !== "awaiting" || deal.money.payment !== "PENDING") return null;
  return deal.paymentProvider === "MANUAL" ? "transfer" : "online";
}

/** Спор решён разделом денег (журнал: выплата проведена частично, остаток возвращён покупателю). */
const splitByDispute = (m: MoneyBlock): boolean => m.kind === "completed" && m.refundedTiyn > 0n;

export type DealChip = { text: string; tone: DealTone };

export type DealChipInput = {
  status: DealStatus;
  hasOpenDispute: boolean;
  /** «Что дальше» модуля; `null` — не удалось прочитать: плашка по статусу. */
  next: Pick<NextStep, "action" | "mine"> | null;
  /** Оплата закрыта до согласия мастера для банка (`payWaitsMaster`). */
  payWaitsMaster?: boolean;
  /** Журнал денег (`moneyBlock`): ожидание оплаты и раздел по спору. */
  money: MoneyBlock;
  paymentProvider: string;
};

const chip = (text: string, tone: DealTone): DealChip => ({ text, tone });

/**
 * Плашка по «что дальше» покупателя. Тон: «внимание» — нужен мой шаг (подпись, оплата, приёмка) или спор; зелёный —
 * деньги в банке под защитой (ждём начала, работа идёт) и сделка завершена; остальное — нейтральное. Шаги мастера и
 * оператора покупателю модуль не отдаёт — для них, как и для неизвестного «дальше», плашка по статусу (`byStatus`).
 */
function byAction(i: DealChipInput): DealChip | null {
  const t = ru.app.deal.status;
  const next = i.next;
  if (!next) return null;
  switch (next.action) {
    case "signContract":
      return next.mine ? chip(t.signOffer, "warn") : null;
    case "waitContractSignature":
      return chip(t.waitOffer, "neutral");
    case "pay":
      if (!next.mine) return null;
      return i.payWaitsMaster ? chip(t.waitMasterBank, "neutral") : chip(t.pay, "warn");
    case "waitPaymentConfirmation":
      return chip(i.paymentProvider === "MANUAL" ? t.transfer : t.processing, "neutral");
    case "waitStart":
      return chip(t.protected, "accent");
    case "waitReady":
      return chip(t.inWork, "accent");
    case "signAct":
      return next.mine ? chip(t.accept, "warn") : null;
    case "waitMasterActSignature":
      return chip(t.waitAct, "neutral");
    case "waitPayout":
      return chip(t.finishing, "neutral");
    case "waitRefund":
      return chip(t.refunding, "neutral");
    case "waitDispute":
      return chip(t.dispute, "warn");
    case "leaveReview":
    case "done":
      return chip(t.done, "accent");
    case "cancelled":
      return chip(t.cancelled, "neutral");
    case "refunded":
      return chip(t.refunded, "neutral");
    case "waitPayment":
    case "startWork":
    case "submitReady":
    case "signActEcp":
    case "waitAct":
    case "resolveDispute":
    case "none":
      return null;
  }
}

/** Плашка по статусу, когда «что дальше» неизвестно: «вашего шага» не знаем — нейтрально, кроме денег под защитой. */
function byStatus(status: DealStatus): DealChip {
  const t = ru.app.deal.status;
  const BY_STATUS: Record<DealStatus, DealChip> = {
    CREATED: chip(t.offer, "neutral"),
    PAID_HOLD: chip(t.protected, "accent"),
    IN_PROGRESS: chip(t.inWork, "accent"),
    READY: chip(t.handedOver, "neutral"),
    ACCEPTED: chip(t.finishing, "neutral"),
    SPLIT_PAYOUT: chip(t.done, "accent"),
    CANCELLED: chip(t.cancelled, "neutral"),
    REFUNDED: chip(t.refunded, "neutral"),
  };
  return BY_STATUS[status];
}

/**
 * Плашка статуса сделки — одна функция для главной, списка «Сделки» и карточки: называет текущий шаг по статусу и «что
 * дальше» (`next`), а не только по статусу. Порядок: открытый спор → отмена и возврат → спор, решённый разделом денег
 * («Спор решён») → ожидание оплаты по журналу («Ждём ваш перевод» / «Оплата обрабатывается») → шаг из «что дальше» →
 * статус. Один текст — всегда один тон (тест-таблица).
 */
export function dealChip(i: DealChipInput): DealChip {
  const t = ru.app.deal.status;
  if (i.hasOpenDispute) return chip(t.dispute, "warn");
  if (i.status === "CANCELLED") return chip(t.cancelled, "neutral");
  if (i.status === "REFUNDED") return chip(t.refunded, "neutral");
  if (splitByDispute(i.money)) return chip(t.disputeResolved, "neutral");
  const wait = paymentWait(i);
  if (wait) return chip(wait === "transfer" ? t.transfer : t.processing, "neutral");
  return byAction(i) ?? byStatus(i.status);
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
