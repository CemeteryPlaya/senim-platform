import type { DealStatus } from "@/generated/prisma/enums";
import { dealProgressView } from "@/features/deal-progress/deal-progress";
import { ru } from "@/i18n/ru";
import type { StepState } from "@/kit";
import type { NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import type { DealSide } from "../../_shell/side";

/**
 * Сделка коротко — общее для главной, списка «Сделки» и карточки сделки обеих сторон (чистые функции без React и базы):
 * ход сделки, тон и текст плашки статуса, строка денег. Одно правило в одном месте: главная, список и карточка говорят
 * одно и то же. Сторона (`side`: покупатель `CLIENT` или мастер `EXECUTOR`) выбирает слова — тексты покупателя в зонах
 * покупателя (`ru.app.deal`, `ru.app.buyer`), мастера — в `ru.app.master`.
 */

const s = ru.app.buyer.home.deal;

/** Подписи пяти шагов хода сделки — одни и те же в строке «Шаг N из 5» (список, главная) и на шкале карточки. */
const stepNames = (side: DealSide): readonly string[] => (side === "CLIENT" ? ru.app.deal.steps : ru.app.master.deal.steps);

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
  // Шагов у обеих сторон одинаково: этапы сделки одни, различаются только подписи.
  return { kind: "steps", done: view.current, total: stepNames("CLIENT").length };
}

/** Строка хода компактной карточки: «Шаг 2 из 5: Изготовление» или «Все шаги пройдены»; остановленной — `null`. */
export function progressCaption(progress: DealProgress, side: DealSide): string | null {
  if (progress.kind === "stopped") return null;
  const d = ru.app.deal;
  if (progress.done >= progress.total) return d.allStepsDone;
  return d.stepCaption(progress.done + 1, progress.total, stepNames(side)[progress.done] ?? "");
}

/** Подпись остановленного хода: спор (покупателю — «оплата мастеру остановлена», мастеру — «оплата вам»), отмена, возврат. */
export const stoppedLabel = (reason: Extract<DealProgress, { kind: "stopped" }>["reason"], side: DealSide): string =>
  (side === "CLIENT" ? s.stopped : ru.app.master.deal.stopped)[reason];

export type DealStepsView =
  | { kind: "steps"; items: { label: string; state: StepState }[]; caption: string; done: number; total: number }
  | { kind: "stopped"; label: string };

/**
 * Полный ход сделки для карточки: пять шагов с отметками и строка «Шаг N из 5»; спор, отмена и возврат — строка вместо
 * шкалы. Спор, решённый разделом или возвратом, тоже останавливает шкалу: «все шаги пройдены» было бы неправдой.
 */
export function dealStepsView(status: DealStatus, hasOpenDispute: boolean, outcome: DisputeOutcome | null, side: DealSide): DealStepsView {
  const card = side === "CLIENT" ? ru.app.deal.card.steps : ru.app.master.deal.stepsStopped;
  if (!hasOpenDispute && outcome === "PARTIAL_SPLIT") return { kind: "stopped", label: card.disputeSplit };
  if (!hasOpenDispute && outcome === "FULL_REFUND" && status !== "REFUNDED") return { kind: "stopped", label: card.disputeRefund };
  const progress = dealProgress(status, hasOpenDispute);
  if (progress.kind === "stopped") return { kind: "stopped", label: stoppedLabel(progress.reason, side) };
  const items = stepNames(side).map((label, index) => {
    const state: StepState = index < progress.done ? "done" : index === progress.done ? "current" : "todo";
    return { label, state };
  });
  return { kind: "steps", items, caption: progressCaption(progress, side) ?? "", done: progress.done, total: progress.total };
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
  /** Чьими глазами: покупатель или мастер. */
  side: DealSide;
  status: DealStatus;
  hasOpenDispute: boolean;
  /** «Что дальше» модуля; `null` — не удалось прочитать: плашка по статусу. */
  next: Pick<NextStep, "action" | "mine"> | null;
  /** Покупатель: оплата закрыта до согласия мастера для банка (`payWaitsMaster`). */
  payWaitsMaster?: boolean;
  /** Мастер: оферта заключена, а его согласия для банка нет — оплата покупателя закрыта им (`masterConsentMissing`). */
  consentMissing?: boolean;
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
function buyerByAction(i: DealChipInput): DealChip | null {
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

/**
 * Плашка по «что дальше» мастера. «Внимание» — нужен его шаг: подписать оферту, дать согласие для банка, начать работу,
 * подписать акт; спор. Изготовление (`submitReady`) — его шаг на недели, поэтому не «внимание», а зелёное «В работе», как
 * и деньги покупателя под защитой. Шаги покупателя и оператора мастеру модуль не отдаёт — для них плашка по статусу.
 */
function masterByAction(i: DealChipInput): DealChip | null {
  const t = ru.app.master.deal.status;
  const next = i.next;
  if (!next) return null;
  switch (next.action) {
    case "signContract":
      return next.mine ? chip(t.signOffer, "warn") : null;
    case "waitContractSignature":
      return chip(t.waitOffer, "neutral");
    case "waitPayment":
      return i.consentMissing ? chip(t.bankConsent, "warn") : chip(t.waitPay, "neutral");
    case "waitPaymentConfirmation":
      return chip(t.processing, "neutral");
    case "startWork":
      return next.mine ? chip(t.start, "warn") : null;
    case "submitReady":
      return next.mine ? chip(t.inWork, "accent") : null;
    case "signActEcp":
      return next.mine ? chip(t.signAct, "warn") : null;
    case "waitAct":
      return chip(t.waitAct, "neutral");
    case "waitPayout":
      return chip(t.finishing, "neutral");
    case "waitRefund":
      return chip(t.refunding, "neutral");
    case "waitDispute":
      return chip(t.dispute, "warn");
    case "done":
      return chip(t.done, "accent");
    case "cancelled":
      return chip(t.cancelled, "neutral");
    case "refunded":
      return chip(t.refunded, "neutral");
    case "pay":
    case "waitStart":
    case "waitReady":
    case "signAct":
    case "waitMasterActSignature":
    case "leaveReview":
    case "resolveDispute":
    case "none":
      return null;
  }
}

/** Плашка по статусу, когда «что дальше» неизвестно: «вашего шага» не знаем — нейтрально, кроме денег под защитой. */
function byStatus(status: DealStatus, side: DealSide): DealChip {
  const t = side === "CLIENT" ? ru.app.deal.status : ru.app.master.deal.status;
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
 * Плашка статуса сделки — одна функция для главной, списка «Сделки» и карточки обеих сторон: называет текущий шаг по
 * статусу и «что дальше» (`next`), а не только по статусу. Порядок: открытый спор → отмена и возврат → спор, решённый
 * разделом денег («Спор решён») → ожидание оплаты по журналу (покупателю — «Ждём ваш перевод» / «Оплата обрабатывается»,
 * мастеру — «Ждём оплату покупателя» / «Оплата обрабатывается») → шаг из «что дальше» → статус. Один текст — всегда один
 * тон (тест-таблицы обеих сторон).
 */
export function dealChip(i: DealChipInput): DealChip {
  const t = i.side === "CLIENT" ? ru.app.deal.status : ru.app.master.deal.status;
  if (i.hasOpenDispute) return chip(t.dispute, "warn");
  if (i.status === "CANCELLED") return chip(t.cancelled, "neutral");
  if (i.status === "REFUNDED") return chip(t.refunded, "neutral");
  if (splitByDispute(i.money)) return chip(t.disputeResolved, "neutral");
  const wait = paymentWait(i);
  if (wait) {
    const transfer = i.side === "CLIENT" ? ru.app.deal.status.transfer : ru.app.master.deal.status.waitPay;
    return chip(wait === "transfer" ? transfer : t.processing, "neutral");
  }
  return (i.side === "CLIENT" ? buyerByAction(i) : masterByAction(i)) ?? byStatus(i.status, i.side);
}

/** Оплата закрыта: шаг покупателя — оплата, а мастер не дал согласие на передачу данных банку. */
export function payWaitsMaster(next: Pick<NextStep, "action" | "mine"> | null, bank: { other: boolean } | null): boolean {
  return next?.action === "pay" && next.mine && bank !== null && !bank.other;
}

/**
 * Мастер: оферта заключена и ждёт оплаты покупателя, а своего согласия на передачу данных банку нет — без него банк не
 * примет оплату. Отметки читаются только до оплаты (`bankConsentState`; иначе `null`).
 */
export function masterConsentMissing(next: Pick<NextStep, "action"> | null, bank: { mine: boolean } | null): boolean {
  return next?.action === "waitPayment" && bank !== null && !bank.mine;
}

export type DealMoneyLine = { amountTiyn: bigint | null; label: string };

/**
 * Строка денег сделки в списке и на главной — только из журнала (`moneyBlock`).
 *
 * Покупатель: до оплаты — смета «к оплате»; в банке (под защитой или спор) — остаток в банке; выплата — без суммы (выплату
 * мастеру с гарантией покупателю не показываем); возврат — сумма возврата «вернулись вам».
 *
 * Мастер: суммы покупателя (к оплате, защита 2%, остаток в банке, возврат) не показываются. До оплаты и пока деньги в банке —
 * «вы получите» (`estimate.totalTiyn` мастера — цена − гарантия 4% из `partyEstimate("EXECUTOR")`: модуль отдаёт смету по
 * стороне); спор — без суммы; оплата — его часть из журнала (`paidToMasterTiyn`), идёт или получена; возврат — без суммы.
 */
export function dealMoneyLine(m: MoneyBlock, estimate: { totalTiyn: bigint }, side: DealSide): DealMoneyLine {
  return side === "CLIENT" ? buyerMoneyLine(m, estimate) : masterMoneyLine(m, estimate);
}

function buyerMoneyLine(m: MoneyBlock, estimate: { totalTiyn: bigint }): DealMoneyLine {
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

function masterMoneyLine(m: MoneyBlock, estimate: { totalTiyn: bigint }): DealMoneyLine {
  const l = ru.app.master.deal.line;
  switch (m.kind) {
    case "awaiting":
      return { amountTiyn: estimate.totalTiyn, label: l.awaiting };
    case "protected":
      return { amountTiyn: estimate.totalTiyn, label: l.protected };
    case "frozen":
      return { amountTiyn: null, label: l.frozen };
    case "completed":
      return { amountTiyn: m.paidToMasterTiyn, label: m.settled ? l.payoutDone : l.payoutPending };
    case "refunded":
      return { amountTiyn: null, label: m.settled ? l.refundDone : l.refundPending };
  }
}
