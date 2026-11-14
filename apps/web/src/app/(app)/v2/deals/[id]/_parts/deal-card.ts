import type { DealStatus, DocumentKind, DocumentStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime, formatDays, formatMonths } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatMoney, type MoneyRow, type MoneyTone } from "@/kit";
import type { BankConsentState, NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import type { DisputeOutcome } from "../../../_parts/deal-summary";
import { to } from "../../../../_shell/paths";

// Вид карточки сделки покупателя (чистые функции, без React и базы): «Сейчас / Дальше» с одним главным действием по
// таблице состояний, блок денег из журнала, «Заказ», «Документы», «История», текст последствий отмены. Страница читает
// модули (getDealView, readDealDocuments, dealContacts, bankConsentState) и отдаёт сюда готовые данные.

const t = ru.app.deal.card;

const dealPath = (id: string) => `/deals/${encodeURIComponent(id)}`;

/** Адреса экранов сделки: подпись, оплата, спор, отзыв, история денег делают следующие задачи (до тех пор — заглушка). */
export const dealHrefs = (id: string) => ({
  card: to(dealPath(id)),
  sign: (documentId: string) => to(`${dealPath(id)}/sign/${encodeURIComponent(documentId)}`),
  pay: to(`${dealPath(id)}/pay`),
  dispute: to(`${dealPath(id)}/dispute`),
  review: to(`${dealPath(id)}/review`),
  money: to(`${dealPath(id)}/money`),
  history: to(`${dealPath(id)}?history=all#history`),
});

// ─── «Сейчас / Дальше» ───────────────────────────────────────────────────────────────────────────────────────────────

/** Строка таблицы «что сейчас». */
export type NowKind =
  | "sign-offer"
  | "wait-offer"
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
  /** «Что дальше» модуля (`deal.next`): действие и чьё оно. */
  next: NextStep;
  /** Действующие оферта и акт приёмки (их подписывает покупатель). */
  contractId: string | null;
  actId: string | null;
  /** PDF оферты (реквизиты для перевода при ручном провайдере). */
  contractPdf: string | null;
  /** К оплате — главная сумма блока денег до оплаты. */
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
  /** Единственное главное действие экрана; `null` — от покупателя сейчас ничего не нужно. */
  primary: { label: string; href: string } | null;
  /** Второстепенная ссылка под «Сейчас»: форма позиции по спору или PDF оферты (`external` — обычная ссылка на файл). */
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
 * Таблица «что сейчас» покупателя по `deal.next` модуля (`deal-core/next-step.ts`). Главное действие ведёт на отдельный
 * экран шага (подпись, оплата, отзыв), а не раскрывает форму здесь. Действия, которых у покупателя не бывает (шаги мастера и
 * оператора), и действие без нужного документа — «Сделка идёт» без кнопки.
 *
 * Оплата и отметки банку (`bankLocked` из features): без своей отметки покупатель всё равно идёт на экран оплаты — отметка
 * ставится там; без отметки мастера оплата закрыта — экран говорит, чего ждём, вместо кнопки. Оплата переводом (ручной
 * провайдер): после «Оплатить» перевод делает сам покупатель — экран говорит, сколько и куда, а не «платить не нужно».
 */
export function nowView(i: NowInput): NowView {
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
      if (i.bank !== null && !i.bank.other) return row("pay-wait-master", n.payWaitMaster);
      return row("pay", n.pay, { label: n.pay.action(formatMoney(i.payTiyn)), href: h.pay });
    case "waitPaymentConfirmation":
      if (!i.manual) return row("pay-pending", n.payPending);
      return row(
        "pay-transfer",
        { title: n.payTransfer.title(formatMoney(i.payTiyn)), body: n.payTransfer.body, next: n.payTransfer.next },
        null,
        i.contractPdf ? { label: n.payTransfer.offer, href: i.contractPdf, external: true } : null,
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
  /** Доказательства из журнала вторичным текстом под блоком: дата резерва и номер операции банка. */
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
      const proof = [m.reservedAt(formatDate(block.reservedAt)), ...(block.operationRef ? [m.operationRef(block.operationRef)] : [])].join(" · ");
      return { tone: "protected", title: m.protected.title, amount: block.amountTiyn, rows: offerRows, note: m.protected.note, proof };
    }
    case "frozen":
      return { tone: "frozen", title: m.frozen.title, amount: block.bankBalanceTiyn, rows: offerRows, note: m.frozen.note };
    case "completed": {
      const split = block.refundedTiyn > 0n;
      const rows = [...offerRows, ...(split ? [{ label: m.refundedRow, amount: block.refundedTiyn }] : [])];
      const c = m.completed;
      const note = split ? (block.settled ? c.splitDone : c.splitPending) : block.settled ? c.done : c.pending;
      return { tone: "completed", title: c.title, amount: snapshot.buyerTotalTiyn, rows, note };
    }
    case "refunded":
      return { tone: "refunded", title: block.settled ? m.refunded.done : m.refunded.pending, amount: block.amountTiyn, rows: [] };
  }
}

// ─── Отмена ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Текст последствий отмены — ровно то, что делает `cancelDeal` модуля: до оплаты (CREATED) сделка отменяется, денег нет;
 * после оплаты (PAID_HOLD, деньги в банке) — возврат всей зарезервированной суммы (`heldEntry`, она же сумма блока
 * «под защитой»), то есть цена и защита сделки: онлайн-оплата — на карту, перевод по реквизитам — «вам».
 * Отмена недоступна (`can.cancel`) или состояние другое — `null`.
 */
export function cancelText(i: { canCancel: boolean; status: DealStatus; block: MoneyBlock; manual: boolean }): string | null {
  if (!i.canCancel) return null;
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
  plannedReadyAt: Date | null;
  signedAt: Date | null;
  durationDays: number;
  warrantyMonths: number;
  /** Дата готовности уже стоит в «Сейчас» — здесь не повторяется. */
  readyShownInNow: boolean;
};

/**
 * «Заказ»: что делаем и существенные условия. Срок — одной строкой: известна плановая дата готовности — дата (если её уже
 * не назвала карточка «Сейчас»), иначе — срок изготовления в днях из оферты. Мастер — в своём блоке.
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

export type DocumentRow = { id: string; name: string; status: string; href: string };

/** Статус подписи словами по роду документа (оферта — она, акт — он); выписка и расписка не подписываются. */
function documentStatus(doc: DocumentInput): string {
  const d = t.documents;
  if (!doc.signable || (doc.kind !== "CONTRACT" && doc.kind !== "ACCEPTANCE_ACT")) return d.notSigned;
  if (doc.status === "SIGNING" && (doc.canSign.hand || doc.canSign.ecp)) return d.yours;
  return d.status[doc.kind][doc.status];
}

/** Документы сделки: название с номером, статус подписи («Ждёт вашей подписи», если не хватает вашей), PDF. */
export function documentRows(docs: readonly DocumentInput[]): DocumentRow[] {
  const d = t.documents;
  return docs.map((doc) => ({ id: doc.id, name: d.name(d.kinds[doc.kind], doc.number), status: documentStatus(doc), href: doc.pdfUrl }));
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

/** Сколько последних событий видно, пока история свёрнута: телефон и компьютер. */
export const HISTORY_SHOWN = { mobile: 3, desktop: 5 } as const;

export type HistoryEvent = { id: string; action: string; actorRole: string; createdAt: Date };

type Phase = "contract" | "act";
/** Текст по стороне события: покупатель — «Вы …», мастер — «Мастер …»; оператор и система — `null`. */
function whose<T>(actor: string, texts: { readonly you: T; readonly master: T }): T | null {
  return actor === "CLIENT" ? texts.you : actor === "EXECUTOR" ? texts.master : null;
}

/**
 * Белый список событий для покупателя: человеческий текст по действию и стороне («Вы …» / «Мастер …»). Подписи документа
 * (от руки и ЭЦП) — одна строка на сторону и документ; документ определяется по ходу сделки (до «Мастер сдал работу» —
 * оферта, после — акт). Служебные события (выпуск документов, операции банка, переписка) и неизвестные — `null`.
 */
function eventTitle(e: HistoryEvent, phase: Phase): string | null {
  const h = t.history;
  switch (e.action) {
    case "deal.created":
      return h.created;
    case "document.signature.added":
    case "document.hand_signature.added":
      return whose<Readonly<Record<Phase, string>>>(e.actorRole, h.signed)?.[phase] ?? null;
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
      return whose<string>(e.actorRole, h.disputeOpened) ?? h.disputeOpened.other;
    case "dispute.position.submitted":
      return whose<string>(e.actorRole, h.position);
    case "dispute.resolved":
      return h.disputeResolved;
    case "deal.cancelled":
      return whose<string>(e.actorRole, h.cancelled) ?? h.cancelled.other;
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
 * События сделки для `Timeline`: события модуля идут по порядку журнала (`seq`); здесь — белый список, по одной строке
 * подписи на сторону и документ, свежие сверху; свёрнутая — последние `limit`.
 */
export function historyView(history: readonly HistoryEvent[], opts: { all: boolean; limit: number }): { items: { title: string; time: string }[]; more: boolean } {
  let phase: Phase = "contract";
  const signedOnce = new Set<string>();
  const shown: { title: string; time: string }[] = [];
  for (const e of history) {
    const title = eventTitle(e, phase);
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
