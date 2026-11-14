import type { DealStatus, DocumentKind, DocumentStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime, formatDays, formatMonths } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatMoney, type MoneyRow, type MoneyTone } from "@/kit";
import type { BankConsentState, NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import type { DisputeOutcome } from "../../../_parts/deal-summary";
import { to } from "../../../../_shell/paths";
import type { DealSide } from "../../../../_shell/side";

// Вид карточки сделки (чистые функции, без React и базы): «Сейчас / Дальше» с одним главным действием по таблице состояний
// стороны, блок денег из журнала, «Заказ», «Документы», «История», текст последствий отмены. Сторона (`side`: покупатель или
// мастер) выбирает таблицу и слова; тексты покупателя — `ru.app.deal.card`, мастера — `ru.app.master.deal`. Страница
// читает модули (getDealView, readDealDocuments, dealContacts, bankConsentState) и отдаёт сюда готовые данные.

const t = ru.app.deal.card;
const tm = ru.app.master.deal;
const tmd = ru.app.masterDeal;

const dealPath = (id: string) => `/deals/${encodeURIComponent(id)}`;

/**
 * Адреса экранов сделки: подпись, спор, история денег — обе стороны; оплата и отзыв — покупатель; начало работы, отчёт о
 * ходе работ и сдача — мастер (экраны мастера делает задача L2, до неё — заглушка «раздел переносится»).
 */
export const dealHrefs = (id: string) => ({
  card: to(dealPath(id)),
  sign: (documentId: string) => to(`${dealPath(id)}/sign/${encodeURIComponent(documentId)}`),
  pay: to(`${dealPath(id)}/pay`),
  start: to(`${dealPath(id)}/start`),
  progress: to(`${dealPath(id)}/progress`),
  ready: to(`${dealPath(id)}/ready`),
  dispute: to(`${dealPath(id)}/dispute`),
  review: to(`${dealPath(id)}/review`),
  money: to(`${dealPath(id)}/money`),
  history: to(`${dealPath(id)}?history=all#history`),
});

// ─── «Сейчас / Дальше» ───────────────────────────────────────────────────────────────────────────────────────────────

/** Строка таблицы «что сейчас» (общие строки и строки стороны: мастер — `bank-consent`, `wait-pay`, `start`, `ready`, `sign-act`). */
export type NowKind =
  | "sign-offer"
  | "wait-offer"
  | "bank-consent"
  | "wait-pay"
  | "start"
  | "ready"
  | "sign-act"
  | "pay"
  | "pay-wait-master"
  | "pay-pending"
  | "pay-transfer"
  | "wait-start"
  | "wait-ready"
  | "accept"
  | "wait-act"
  | "wait-payout"
  | "wait-refund"
  | "wait-settlement"
  | "dispute"
  | "dispute-split"
  | "dispute-refund"
  | "review"
  | "done"
  | "cancelled"
  | "refunded"
  | "unknown";

export type NowInput = {
  id: string;
  /** Чьими глазами: покупатель (`CLIENT`) или мастер (`EXECUTOR`) — сторона из `partyDeal`. */
  side: DealSide;
  /** «Что дальше» модуля (`deal.next`): действие и чьё оно. */
  next: NextStep;
  /** Действующие оферта и акт приёмки (их подписывают обе стороны). */
  contractId: string | null;
  actId: string | null;
  /** PDF оферты (реквизиты для перевода при ручном провайдере). */
  contractPdf: string | null;
  /** Покупатель: к оплате — главная сумма блока денег до оплаты. Мастеру не показывается. */
  payTiyn: bigint;
  /** Оплата переводом по реквизитам (провайдер `MANUAL`): перевод делает сам покупатель, оператор подтверждает. */
  manual: boolean;
  /** Отметки сторон «Передача данных банку» (только до оплаты; иначе или при сбое чтения — `null`). */
  bank: BankConsentState | null;
  /** Плановая готовность из модуля, если известна. */
  plannedReadyAt: Date | null;
  /** Своей позиции по открытому спору ещё нет (`needsPosition`). */
  needsPosition: boolean;
  /** Деньги уходят из банка целиком покупателю (журнал: `moneyBlock.kind === "refunded"`), а не частями. */
  refundAll: boolean;
  /** Исход решённого спора (последний спор); открыт или не было — `null`. */
  disputeOutcome: DisputeOutcome | null;
};

export type NowView = {
  kind: NowKind;
  title: string;
  body?: string;
  next?: string;
  /** Единственное главное действие экрана; `null` — от смотрящего сейчас ничего не нужно. */
  primary: { label: string; href: string } | null;
  /**
   * Второстепенная ссылка под «Сейчас»: позиция по спору, согласие заранее (экран оплаты), PDF оферты (`external` — файл в
   * новой вкладке) или отчёт о ходе работ (мастер).
   */
  link: { label: string; href: string; external?: boolean } | null;
};

const row = (kind: NowKind, text: { title: string; body?: string; next?: string }, primary: NowView["primary"] = null, link: NowView["link"] = null): NowView => ({
  kind,
  title: text.title,
  ...(text.body ? { body: text.body } : {}),
  ...(text.next ? { next: text.next } : {}),
  primary,
  link,
});

/** Строка решённого спора, если исход меняет картину: раздел и полный возврат. `CONTINUE` — сделка идёт как обычно. */
function resolvedDispute(i: NowInput, review: NowView["primary"]): NowView | null {
  const n = t.now;
  const { action } = i.next;
  const leaving = action === "waitRefund" || action === "waitPayout";
  if (i.disputeOutcome === "PARTIAL_SPLIT" && (leaving || action === "done" || action === "leaveReview")) {
    return row("dispute-split", { title: n.disputeSplit.title, body: leaving ? n.disputeSplit.pending : n.disputeSplit.done }, review);
  }
  if (i.disputeOutcome === "FULL_REFUND" && (action === "waitRefund" || action === "refunded")) {
    const done = action === "refunded";
    return row("dispute-refund", { title: done ? n.disputeRefund.done : n.disputeRefund.pending, body: done ? n.disputeRefund.bodyDone : n.disputeRefund.body });
  }
  return null;
}

/**
 * «Сейчас / Дальше» по стороне: таблица покупателя или мастера (`buyerNow`, `masterNow`).
 *
 * Таблица «что сейчас» покупателя по `deal.next` модуля (`deal-core/next-step.ts`). Главное действие ведёт на отдельный
 * экран шага (подпись, оплата, отзыв), а не раскрывает форму здесь. Действия, которых у покупателя не бывает (шаги мастера и
 * оператора), и действие без нужного документа — «Сделка идёт» без кнопки.
 *
 * Оплата и отметки банку (`bankLocked` из features): без своей отметки покупатель всё равно идёт на экран оплаты — отметка
 * ставится там; без отметки мастера оплата закрыта — экран говорит, чего ждём, вместо кнопки. Оплата переводом (ручной
 * провайдер): после «Оплатить» перевод делает сам покупатель — экран говорит, сколько и куда, а не «платить не нужно».
 */
export function nowView(i: NowInput): NowView {
  return i.side === "CLIENT" ? buyerNow(i) : masterNow(i);
}

function buyerNow(i: NowInput): NowView {
  const n = t.now;
  const h = dealHrefs(i.id);
  const { action, mine } = i.next;
  const review = action === "leaveReview" && mine ? { label: n.review.action, href: h.review } : null;
  const resolved = resolvedDispute(i, review);
  if (resolved) return resolved;
  switch (action) {
    case "signContract":
      return mine && i.contractId ? row("sign-offer", n.signOffer, { label: n.signOffer.action, href: h.sign(i.contractId) }) : row("unknown", n.unknown);
    case "waitContractSignature":
      return row("wait-offer", n.waitOffer);
    case "pay":
      if (!mine) return row("unknown", n.unknown);
      if (i.bank !== null && !i.bank.other) {
        const w = n.payWaitMaster;
        // Своё согласие можно дать заранее — второстепенной ссылкой на экран оплаты; дано — ссылки нет, ждём мастера.
        return i.bank.mine
          ? row("pay-wait-master", { ...w, title: w.titleMineGiven })
          : row("pay-wait-master", w, null, { label: w.ahead, href: h.pay });
      }
      return row("pay", n.pay, { label: n.pay.action(formatMoney(i.payTiyn)), href: h.pay });
    case "waitPaymentConfirmation":
      if (!i.manual) return row("pay-pending", n.payPending);
      return row(
        "pay-transfer",
        { title: n.payTransfer.title(formatMoney(i.payTiyn)), body: n.payTransfer.body, next: n.payTransfer.next },
        null,
        i.contractPdf ? { label: ru.app.deal.openDocument.CONTRACT, href: i.contractPdf, external: true } : null,
      );
    case "waitStart":
      return row("wait-start", n.waitStart);
    case "waitReady":
      return row("wait-ready", { ...n.waitReady, body: i.plannedReadyAt ? n.waitReady.readyBy(formatDate(i.plannedReadyAt)) : n.waitReady.body });
    case "signAct":
      return mine && i.actId ? row("accept", n.accept, { label: n.accept.action, href: h.sign(i.actId) }) : row("unknown", n.unknown);
    case "waitMasterActSignature":
      return row("wait-act", n.waitAct);
    case "waitPayout":
      return row("wait-payout", n.waitPayout);
    case "waitRefund":
      return i.refundAll ? row("wait-refund", n.waitRefund) : row("wait-settlement", n.waitSettlement);
    case "waitDispute":
      return row("dispute", n.dispute, null, i.needsPosition ? { label: n.dispute.position, href: h.dispute } : null);
    case "leaveReview":
      return review ? row("review", n.review, review) : row("done", n.done);
    case "done":
      return row("done", n.done);
    case "cancelled":
      return row("cancelled", n.cancelled);
    case "refunded":
      return row("refunded", n.refunded);
    // Шаги мастера и оператора: покупателю их не показывает модуль; на всякий случай — без кнопки.
    case "waitPayment":
    case "startWork":
    case "submitReady":
    case "signActEcp":
    case "waitAct":
    case "resolveDispute":
    case "none":
      return row("unknown", n.unknown);
  }
}

/** Строка решённого спора мастера, если исход меняет картину: раздел и полный возврат покупателю. */
function masterResolvedDispute(i: NowInput): NowView | null {
  const n = tm.now;
  const { action } = i.next;
  const leaving = action === "waitRefund" || action === "waitPayout";
  if (i.disputeOutcome === "PARTIAL_SPLIT" && (leaving || action === "done")) {
    return row("dispute-split", { title: n.disputeSplit.title, body: leaving ? n.disputeSplit.pending : n.disputeSplit.done });
  }
  if (i.disputeOutcome === "FULL_REFUND" && (action === "waitRefund" || action === "refunded")) {
    const done = action === "refunded";
    return row("dispute-refund", { title: done ? n.disputeRefund.done : n.disputeRefund.pending, body: done ? n.disputeRefund.bodyDone : n.disputeRefund.body });
  }
  return null;
}

/**
 * Таблица «что сейчас» мастера по `deal.next` модуля (`deal-core/next-step.ts`). Главное действие ведёт на экран шага:
 * подпись оферты (там же согласие на передачу данных банку — без него подпись закрыта), начало работы, сдача работы,
 * подпись акта ЭЦП. Сумм покупателя (к оплате, защита 2%) здесь нет. Шаги покупателя и оператора и действие без нужного
 * документа — «Сделка идёт» без кнопки.
 *
 * Оферта заключена, а своего согласия для банка нет (`bank.mine === false` при ожидании оплаты) — оплату покупателя
 * закрывает мастер: строка «Дайте согласие для банка» ведёт на экран оферты, где ставится согласие.
 */
function masterNow(i: NowInput): NowView {
  const n = tm.now;
  const h = dealHrefs(i.id);
  const { action, mine } = i.next;
  const resolved = masterResolvedDispute(i);
  if (resolved) return resolved;
  switch (action) {
    case "signContract": {
      if (!mine || !i.contractId) return row("unknown", n.unknown);
      const body = i.bank?.mine ? n.signOffer.bodyConsentGiven : n.signOffer.body;
      return row("sign-offer", { ...n.signOffer, body }, { label: n.signOffer.action, href: h.sign(i.contractId) });
    }
    case "waitContractSignature":
      return row("wait-offer", n.waitOffer);
    case "waitPayment":
      if (i.bank !== null && !i.bank.mine) {
        return i.contractId ? row("bank-consent", n.bankConsent, { label: n.bankConsent.action, href: h.sign(i.contractId) }) : row("bank-consent", n.bankConsent);
      }
      return row("wait-pay", n.waitPay);
    case "waitPaymentConfirmation":
      return row("pay-pending", n.payPending);
    case "startWork":
      return mine ? row("start", n.start, { label: n.start.action, href: h.start }) : row("unknown", n.unknown);
    case "submitReady": {
      if (!mine) return row("unknown", n.unknown);
      const body = i.plannedReadyAt ? n.ready.readyBy(formatDate(i.plannedReadyAt)) : n.ready.body;
      return row("ready", { ...n.ready, body }, { label: n.ready.action, href: h.ready }, { label: n.ready.progress, href: h.progress });
    }
    case "signActEcp":
      return mine && i.actId ? row("sign-act", n.signAct, { label: n.signAct.action, href: h.sign(i.actId) }) : row("unknown", n.unknown);
    case "waitAct":
      return row("wait-act", n.waitAct);
    case "waitPayout":
      return row("wait-payout", n.waitPayout);
    case "waitRefund":
      return i.refundAll ? row("wait-refund", n.waitRefund) : row("wait-settlement", n.waitSettlement);
    case "waitDispute":
      return row("dispute", n.dispute, null, i.needsPosition ? { label: n.dispute.position, href: h.dispute } : null);
    case "done":
      return row("done", n.done);
    case "cancelled":
      return row("cancelled", n.cancelled);
    case "refunded":
      return row("refunded", n.refunded);
    // Шаги покупателя и оператора: мастеру их не показывает модуль; на всякий случай — без кнопки.
    case "pay":
    case "waitStart":
    case "waitReady":
    case "signAct":
    case "waitMasterActSignature":
    case "leaveReview":
    case "resolveDispute":
    case "none":
      return row("unknown", n.unknown);
  }
}

// ─── Деньги ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Снимок оферты (`deal.money`) и смета покупателя (`deal.estimate`) — суммы из модуля, здесь ничего не считается. */
export type MoneyInput = {
  block: MoneyBlock;
  estimate: { priceTiyn: bigint; extraTiyn: bigint; totalTiyn: bigint };
  snapshot: { priceTiyn: bigint; protectionTiyn: bigint; buyerTotalTiyn: bigint };
  /** Оплата переводом по реквизитам (провайдер `MANUAL`); по умолчанию — нет. */
  manual?: boolean;
};

export type MoneyView = {
  tone: MoneyTone;
  title: string;
  amount: bigint;
  rows: (Omit<MoneyRow, "explain"> & { explain?: true })[];
  note?: string;
  /** Доказательство из журнала вторичным текстом под блоком: дата резерва (номер операции банка — только в «Операциях»). */
  proof?: string;
};

/**
 * Блок денег покупателя — только из журнала (`moneyBlock`): тон по виду блока (`protected` — единственный зелёный),
 * главная сумма — то, что сейчас важно покупателю: к оплате, в банке, сколько он заплатил (после выплаты), сколько
 * возвращено. Выплату мастеру (цена − гарантия 4%) покупателю не показываем. Строки «Цена по оферте» и «Защита сделки
 * (2%)» — снимок оферты; у защиты — пояснение. Пометка тестового платежа (`isTest`) в v2 не выводится.
 */
export function moneyView({ block, estimate, snapshot, manual = false }: MoneyInput): MoneyView {
  const m = t.money;
  const offerRows = [
    { label: m.price, amount: snapshot.priceTiyn },
    { label: m.protection, amount: snapshot.protectionTiyn, explain: true as const },
  ];
  switch (block.kind) {
    case "awaiting": {
      const text = block.payment === "PENDING" ? (manual ? m.transfer : m.pending) : block.payment === "FAILED" ? m.failed : m.awaiting;
      const rows = [
        { label: m.price, amount: estimate.priceTiyn },
        { label: m.protection, amount: estimate.extraTiyn, explain: true as const },
        { label: m.total, amount: estimate.totalTiyn, total: true },
      ];
      return { tone: "awaiting", title: text.title, amount: estimate.totalTiyn, rows, note: text.note };
    }
    case "protected": {
      return { tone: "protected", title: m.protected.title, amount: block.amountTiyn, rows: offerRows, note: m.protected.note, proof: m.reservedAt(formatDate(block.reservedAt)) };
    }
    case "frozen":
      return { tone: "frozen", title: m.frozen.title, amount: block.bankBalanceTiyn, rows: offerRows, note: m.frozen.note };
    case "completed": {
      const split = block.refundedTiyn > 0n;
      const rows = [...offerRows, ...(split ? [{ label: m.refundedRow, amount: block.refundedTiyn }] : [])];
      const c = m.completed;
      const note = split ? (block.settled ? c.splitDone : c.splitPending) : block.settled ? c.done : c.pending;
      // Сколько заплатил покупатель — из журнала (`paidTiyn`, подтверждённая оплата); снимок оферты — только если оплаты в журнале нет.
      return { tone: "completed", title: c.title, amount: block.paidTiyn ?? snapshot.buyerTotalTiyn, rows, note };
    }
    case "refunded":
      return { tone: "refunded", title: block.settled ? m.refunded.done : m.refunded.pending, amount: block.amountTiyn, rows: [] };
  }
}

/** Деньги мастера: журнал (`moneyBlock`) и смета мастера (`partyEstimate("EXECUTOR")` модуля: цена, гарантия 4%, «вы получите»). */
export type MasterMoneyInput = {
  block: MoneyBlock;
  estimate: { priceTiyn: bigint; extraTiyn: bigint; totalTiyn: bigint };
};

/**
 * Блок денег мастера — только из журнала (`moneyBlock`) и сметы мастера, ничего не считается здесь. Главная сумма — всегда
 * сумма мастера, и заголовок называет её: пока оплаты мастеру нет (ждём оплату, оплата идёт или не прошла, деньги
 * покупателя в банке) — «Вы получите после приёмки» (цена по оферте − гарантия 4%), а состояние — первой фразой пояснения;
 * спор — «Оплата вам приостановлена спором»; после раскрытия — его часть из журнала (`paidToMasterTiyn`: идёт или получена).
 * Строки — «Цена по оферте», «Гарантия оплаты и клиента (4%)» с пояснением и «Вы получите». Сумм покупателя (к оплате,
 * защита 2%, остаток в банке, возврат) мастеру не показываем: при возврате покупателю — «Вы получите по этой сделке: 0 ₸».
 */
export function masterMoneyView({ block, estimate }: MasterMoneyInput): MoneyView {
  const m = tmd.card.money;
  const priceRow = { label: m.price, amount: estimate.priceTiyn };
  const offerRows = (youGet: bigint) => [
    priceRow,
    { label: m.guarantee, amount: estimate.extraTiyn, explain: true as const },
    { label: m.youGet, amount: youGet, total: true },
  ];
  switch (block.kind) {
    case "awaiting": {
      const note = block.payment === "PENDING" ? m.pending : block.payment === "FAILED" ? m.failed : m.awaiting;
      return { tone: "awaiting", title: m.youGetAfter, amount: estimate.totalTiyn, rows: offerRows(estimate.totalTiyn), note };
    }
    case "protected":
      return {
        tone: "protected",
        title: m.youGetAfter,
        amount: estimate.totalTiyn,
        rows: offerRows(estimate.totalTiyn),
        note: m.protected,
        proof: m.reservedAt(formatDate(block.reservedAt)),
      };
    case "frozen":
      return { tone: "frozen", title: m.frozen.title, amount: estimate.totalTiyn, rows: offerRows(estimate.totalTiyn), note: m.frozen.note };
    case "completed": {
      const c = m.completed;
      // Раздел по спору: часть оплаты мастеру по решению, гарантия от доли — не от сметы; строки сметы ввели бы в заблуждение.
      if (block.refundedTiyn > 0n) {
        return {
          tone: "completed",
          title: block.settled ? c.splitDone : c.splitPending,
          amount: block.paidToMasterTiyn,
          rows: [priceRow],
          note: block.settled ? c.splitNote : c.splitNotePending,
        };
      }
      return { tone: "completed", title: block.settled ? c.done : c.pending, amount: block.paidToMasterTiyn, rows: offerRows(block.paidToMasterTiyn) };
    }
    case "refunded":
      return { tone: "refunded", title: m.refunded.title, amount: 0n, rows: [priceRow], note: block.settled ? m.refunded.done : m.refunded.pending };
  }
}

// ─── Отмена ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Текст последствий отмены — ровно то, что делает `cancelDeal` модуля: до оплаты (CREATED) сделка отменяется, денег нет;
 * после оплаты (PAID_HOLD, деньги в банке) — возврат всей зарезервированной суммы (`heldEntry`, она же сумма блока
 * «под защитой»), то есть цена и защита сделки: онлайн-оплата — на карту, перевод по реквизитам — «вам».
 * Мастер отменяет только до оплаты (`can.cancel` модуля): после оплаты отменяет покупатель, текста мастеру нет.
 * Отмена недоступна (`can.cancel`) или состояние другое — `null`.
 */
export function cancelText(i: { side: DealSide; canCancel: boolean; status: DealStatus; block: MoneyBlock; manual: boolean }): string | null {
  if (!i.canCancel) return null;
  if (i.side === "EXECUTOR") return i.status === "CREATED" ? tm.actions.cancelBeforePay : null;
  if (i.status === "CREATED") return t.actions.cancelBeforePay;
  if (i.status === "PAID_HOLD" && i.block.kind === "protected") {
    const amount = formatMoney(i.block.amountTiyn);
    return i.manual ? t.actions.cancelAfterTransfer(amount) : t.actions.cancelAfterPay(amount);
  }
  return null;
}

// ─── Заказ, документы, история ───────────────────────────────────────────────────────────────────────────────────────

export type OrderInput = {
  title: string;
  city: string | null;
  /** Адрес заказа — мастеру, когда его отдал модуль заявок и оферта заключена; иначе нет. */
  address?: string | null;
  plannedReadyAt: Date | null;
  signedAt: Date | null;
  durationDays: number;
  warrantyMonths: number;
  /** Дата готовности уже стоит в «Сейчас» — здесь не повторяется. */
  readyShownInNow: boolean;
};

/**
 * «Заказ»: что делаем и существенные условия. Срок — одной строкой: известна плановая дата готовности — дата (если её уже
 * не назвала карточка «Сейчас»), иначе — срок изготовления в днях из оферты. Адрес — только если он передан (мастеру после
 * оферты). Другая сторона — в своём блоке.
 */
export function orderRows(o: OrderInput): { label: string; value: string }[] {
  const r = t.order;
  const term = o.plannedReadyAt
    ? o.readyShownInNow
      ? []
      : [{ label: r.readyBy, value: formatDate(o.plannedReadyAt) }]
    : [{ label: r.duration, value: formatDays(o.durationDays) }];
  return [
    { label: r.what, value: o.title },
    ...(o.city ? [{ label: r.city, value: o.city }] : []),
    ...(o.address ? [{ label: tmd.card.order.address, value: o.address }] : []),
    ...term,
    { label: r.warranty, value: formatMonths(o.warrantyMonths) },
    ...(o.signedAt ? [{ label: r.signedAt, value: formatDate(o.signedAt) }] : []),
  ];
}

export type DocumentInput = {
  id: string;
  kind: DocumentKind;
  number: string;
  status: DocumentStatus;
  pdfUrl: string;
  /** Документ подписывается в приложении (оферта, акт); выписка и расписка — нет. */
  signable: boolean;
  /** Чего не хватает от покупателя (модуль documents). */
  canSign: { hand: boolean; ecp: boolean };
};

export type DocumentRow = {
  id: string;
  name: string;
  status: string;
  href: string;
  /** Подпись ссылки: «Открыть» и вид документа («Открыть оферту», «Открыть акт», «Открыть выписку»). */
  open: string;
};

/**
 * Статус подписи словами по роду документа (оферта — она, акт — он); выписка и расписка не подписываются. Акт, который
 * так и остался неподписанным, когда сделку закрыло решение по спору (раздел или полный возврат), — «Не подписан: спор
 * решён оператором», а не «Ждёт подписей».
 */
function documentStatus(doc: DocumentInput, outcome: DisputeOutcome | null): string {
  const d = t.documents;
  if (!doc.signable || (doc.kind !== "CONTRACT" && doc.kind !== "ACCEPTANCE_ACT")) return d.notSigned;
  if (doc.kind === "ACCEPTANCE_ACT" && doc.status === "SIGNING" && (outcome === "PARTIAL_SPLIT" || outcome === "FULL_REFUND")) return d.actByDispute;
  if (doc.status === "SIGNING" && (doc.canSign.hand || doc.canSign.ecp)) return d.yours;
  return d.status[doc.kind][doc.status];
}

/**
 * Документы сделки: название с номером, статус подписи («Ждёт вашей подписи», если не хватает вашей), PDF и подпись ссылки
 * по виду документа. `outcome` — исход решённого спора сделки (если был).
 */
export function documentRows(docs: readonly DocumentInput[], outcome: DisputeOutcome | null = null): DocumentRow[] {
  const d = t.documents;
  return docs.map((doc) => ({
    id: doc.id,
    name: d.name(d.kinds[doc.kind], doc.number),
    status: documentStatus(doc, outcome),
    href: doc.pdfUrl,
    open: ru.app.deal.openDocument[doc.kind],
  }));
}

/** Оставленный отзыв (`deal.review`): строки «Оценка», «Отзыв» (если есть текст), «Оставлен». */
export function reviewRows(review: { rating: number; text: string | null; createdAt: Date } | null): { label: string; value: string; stacked: boolean }[] | null {
  if (!review) return null;
  const r = t.review;
  return [
    { label: r.rating, value: r.ratingValue(review.rating), stacked: false },
    ...(review.text ? [{ label: r.text, value: review.text, stacked: true }] : []),
    { label: r.date, value: formatDate(review.createdAt), stacked: false },
  ];
}

export type ReportInput = { id: string; title: string | null; text: string; createdAt: Date; photos: { id: string; src: string }[] };

export type ReportView = { id: string; title: string; time: string; text: string; photos: { id: string; src: string; alt: string }[] };

/**
 * «Ход работ» мастера: отчёты из модуля (`deal.progressReports`, по порядку создания) — свежие сверху; без названия —
 * «Отчёт о ходе работ»; у фото — подпись с названием отчёта и номером.
 */
export function reportsView(reports: readonly ReportInput[]): ReportView[] {
  const r = t.reports;
  return [...reports].reverse().map((report) => {
    const title = report.title?.trim() || r.untitled;
    return {
      id: report.id,
      title,
      time: formatDateTime(report.createdAt),
      text: report.text,
      photos: report.photos.map((photo, index) => ({ id: photo.id, src: photo.src, alt: r.photoAlt(title, index + 1) })),
    };
  });
}

/** Сколько последних событий видно, пока история свёрнута: телефон и компьютер. */
export const HISTORY_SHOWN = { mobile: 3, desktop: 5 } as const;

export type HistoryEvent = { id: string; action: string; actorRole: string; createdAt: Date };

type Phase = "contract" | "act";

/** Тексты истории стороны в одном виде: «вы» — смотрящий, «другая сторона» — покупатель для мастера и мастер для покупателя. */
type HistoryTexts = {
  created: string;
  signed: { you: Readonly<Record<Phase, string>>; other: Readonly<Record<Phase, string>> };
  concluded: string;
  paid: string;
  started: string;
  progress: string;
  ready: string;
  accepted: string;
  completed: string;
  disputeOpened: { you: string; other: string; unknown: string };
  position: { you: string; other: string };
  disputeResolved: string;
  cancelled: { you: string; other: string; unknown: string };
  cancelRequested: string;
  refunded: string;
  review: string;
};

function historyTexts(side: DealSide): HistoryTexts {
  if (side === "EXECUTOR") return tm.history;
  const h = t.history;
  return {
    ...h,
    signed: { you: h.signed.you, other: h.signed.master },
    disputeOpened: { you: h.disputeOpened.you, other: h.disputeOpened.master, unknown: h.disputeOpened.other },
    position: { you: h.position.you, other: h.position.master },
    cancelled: { you: h.cancelled.you, other: h.cancelled.master, unknown: h.cancelled.other },
  };
}

/** Текст по стороне события: смотрящий — «Вы …», другая сторона — «Мастер …» / «Покупатель …»; оператор и система — `null`. */
function whose<T>(actor: string, side: DealSide, texts: { readonly you: T; readonly other: T }): T | null {
  if (actor === side) return texts.you;
  return actor === "CLIENT" || actor === "EXECUTOR" ? texts.other : null;
}

/**
 * Белый список событий для стороны: человеческий текст по действию и стороне («Вы …» / «Мастер …» у покупателя, «Вы …» /
 * «Покупатель …» у мастера). Подписи документа (от руки и ЭЦП) — одна строка на сторону и документ; документ определяется
 * по ходу сделки (до «Мастер сдал работу» — оферта, после — акт). Служебные события (выпуск документов, операции банка,
 * переписка) и неизвестные — `null`.
 */
function eventTitle(e: HistoryEvent, phase: Phase, side: DealSide, h: HistoryTexts): string | null {
  switch (e.action) {
    case "deal.created":
      return h.created;
    case "document.signature.added":
    case "document.hand_signature.added":
      return whose(e.actorRole, side, h.signed)?.[phase] ?? null;
    case "deal.signed":
      return h.concluded;
    case "deal.paid":
      return h.paid;
    case "deal.started":
      return h.started;
    case "deal.progress.reported":
      return h.progress;
    case "deal.ready":
      return h.ready;
    case "deal.accepted":
      return h.accepted;
    case "deal.completed":
      return h.completed;
    case "dispute.opened":
      return whose(e.actorRole, side, h.disputeOpened) ?? h.disputeOpened.unknown;
    case "dispute.position.submitted":
      return whose(e.actorRole, side, h.position);
    case "dispute.resolved":
      return h.disputeResolved;
    case "deal.cancelled":
      return whose(e.actorRole, side, h.cancelled) ?? h.cancelled.unknown;
    case "deal.cancel.requested":
      return h.cancelRequested;
    case "deal.refunded":
      return h.refunded;
    case "review.created":
      return h.review;
    default:
      return null;
  }
}

/**
 * События сделки для `Timeline` глазами стороны (`side`): события модуля идут по порядку журнала (`seq`); здесь — белый
 * список, по одной строке подписи на сторону и документ, свежие сверху; свёрнутая — последние `limit`.
 */
export function historyView(
  history: readonly HistoryEvent[],
  opts: { all: boolean; limit: number },
  side: DealSide,
): { items: { title: string; time: string }[]; more: boolean } {
  const texts = historyTexts(side);
  let phase: Phase = "contract";
  const signedOnce = new Set<string>();
  const shown: { title: string; time: string }[] = [];
  for (const e of history) {
    const title = eventTitle(e, phase, side, texts);
    if (e.action === "deal.ready") phase = "act";
    if (title === null) continue;
    if (e.action === "document.signature.added" || e.action === "document.hand_signature.added") {
      const key = `${phase}:${e.actorRole}`;
      if (signedOnce.has(key)) continue;
      signedOnce.add(key);
    }
    shown.push({ title, time: formatDateTime(e.createdAt) });
  }
  const fresh = shown.reverse();
  return { items: opts.all ? fresh : fresh.slice(0, opts.limit), more: !opts.all && fresh.length > opts.limit };
}
