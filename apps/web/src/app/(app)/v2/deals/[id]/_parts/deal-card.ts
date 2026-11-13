import type { DealStatus, DocumentKind, DocumentStatus } from "@/generated/prisma/enums";
import { orderFacts } from "@/features/deal-view/facts";
import { formatDate, formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatMoney, type MoneyRow, type MoneyTone } from "@/kit";
import type { BankConsentState, NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import { to } from "../../../../_shell/paths";

// Вид карточки сделки покупателя (чистые функции, без React и базы): «Сейчас / Дальше» с одним главным действием по
// таблице состояний, блок денег из журнала, «Заказ», «Документы», «История», текст последствий отмены. Страница читает
// модули (getDealView, listDealDocuments, dealContacts, bankConsentState) и отдаёт сюда готовые данные.

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
  | "wait-start"
  | "wait-ready"
  | "accept"
  | "wait-act"
  | "wait-payout"
  | "wait-refund"
  | "wait-settlement"
  | "dispute"
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
  /** К оплате — главная сумма блока денег до оплаты. */
  payTiyn: bigint;
  /** Отметки сторон «Передача данных банку» (только до оплаты; иначе `null`). */
  bank: BankConsentState | null;
  /** Плановая готовность из модуля, если известна. */
  plannedReadyAt: Date | null;
  /** Своей позиции по открытому спору ещё нет (`needsPosition`). */
  needsPosition: boolean;
  /** Деньги уходят из банка целиком покупателю (журнал: `moneyBlock.kind === "refunded"`), а не частями по решению спора. */
  refundAll: boolean;
};

export type NowView = {
  kind: NowKind;
  title: string;
  body?: string;
  next?: string;
  /** Единственное главное действие экрана; `null` — от покупателя сейчас ничего не нужно. */
  primary: { label: string; href: string } | null;
  /** Второстепенная ссылка под «Сейчас» (форма позиции по спору). */
  link: { label: string; href: string } | null;
};

const row = (kind: NowKind, text: { title: string; body?: string; next?: string }, primary: NowView["primary"] = null, link: NowView["link"] = null): NowView => ({
  kind,
  title: text.title,
  ...(text.body ? { body: text.body } : {}),
  ...(text.next ? { next: text.next } : {}),
  primary,
  link,
});

/**
 * Таблица «что сейчас» покупателя по `deal.next` модуля (`deal-core/next-step.ts`). Главное действие ведёт на отдельный
 * экран шага (подпись, оплата, отзыв), а не раскрывает форму здесь. Действия, которых у покупателя не бывает (шаги мастера и
 * оператора), и действие без нужного документа — «Сделка идёт» без кнопки.
 *
 * Оплата и отметки банку (`bankLocked` из features): без своей отметки покупатель всё равно идёт на экран оплаты — отметка
 * ставится там; без отметки мастера оплата закрыта — экран говорит, чего ждём, вместо кнопки.
 */
export function nowView(i: NowInput): NowView {
  const n = t.now;
  const h = dealHrefs(i.id);
  const { action, mine } = i.next;
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
      return row("pay-pending", n.payPending);
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
      return mine ? row("review", n.review, { label: n.review.action, href: h.review }) : row("done", n.done);
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
  snapshot: { priceTiyn: bigint; protectionTiyn: bigint };
};

export type MoneyView = { tone: MoneyTone; title: string; amount: bigint; rows: (Omit<MoneyRow, "explain"> & { explain?: true })[]; note?: string };

/**
 * Блок денег покупателя — только из журнала (`moneyBlock`): тон по виду блока (`protected` — единственный зелёный),
 * главная сумма — то, что сейчас важно (к оплате, в банке, мастеру, возвращено). Строки «Цена по оферте» и «Защита сделки
 * (2%)» — снимок оферты; у защиты — пояснение. Пометка тестового платежа (`isTest`) в v2 не выводится.
 */
export function moneyView({ block, estimate, snapshot }: MoneyInput): MoneyView {
  const m = t.money;
  const offerRows = [
    { label: m.price, amount: snapshot.priceTiyn },
    { label: m.protection, amount: snapshot.protectionTiyn, explain: true as const },
  ];
  switch (block.kind) {
    case "awaiting": {
      const text = block.payment === "PENDING" ? m.pending : block.payment === "FAILED" ? m.failed : m.awaiting;
      const rows = [
        { label: m.price, amount: estimate.priceTiyn },
        { label: m.protection, amount: estimate.extraTiyn, explain: true as const },
        { label: m.total, amount: estimate.totalTiyn, total: true },
      ];
      return { tone: "awaiting", title: text.title, amount: estimate.totalTiyn, rows, note: text.note };
    }
    case "protected":
      return { tone: "protected", title: m.protected.title, amount: block.amountTiyn, rows: offerRows, note: m.protected.note };
    case "frozen":
      return { tone: "frozen", title: m.frozen.title, amount: block.bankBalanceTiyn, rows: offerRows, note: m.frozen.note };
    case "completed": {
      const rows = [
        { label: m.protection, amount: block.protectionTiyn, explain: true as const },
        ...(block.refundedTiyn > 0n ? [{ label: m.refundedRow, amount: block.refundedTiyn }] : []),
      ];
      return { tone: "completed", title: block.settled ? m.completed.done : m.completed.pending, amount: block.paidToMasterTiyn, rows };
    }
    case "refunded":
      return { tone: "refunded", title: block.settled ? m.refunded.done : m.refunded.pending, amount: block.amountTiyn, rows: [] };
  }
}

// ─── Отмена ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Текст последствий отмены — ровно то, что делает `cancelDeal` модуля: до оплаты (CREATED) сделка отменяется, денег нет;
 * после оплаты (PAID_HOLD, деньги в банке) — возврат всей зарезервированной суммы (`heldEntry`, она же сумма блока
 * «под защитой»), то есть цена и защита сделки. Отмена недоступна (`can.cancel`) или состояние другое — `null`.
 */
export function cancelText(i: { canCancel: boolean; status: DealStatus; block: MoneyBlock }): string | null {
  if (!i.canCancel) return null;
  if (i.status === "CREATED") return t.actions.cancelBeforePay;
  if (i.status === "PAID_HOLD" && i.block.kind === "protected") return t.actions.cancelAfterPay(formatMoney(i.block.amountTiyn));
  return null;
}

// ─── Заказ, документы, история ───────────────────────────────────────────────────────────────────────────────────────

export type OrderInput = {
  title: string;
  executorLabel: string;
  city: string | null;
  plannedReadyAt: Date | null;
  signedAt: Date | null;
  durationDays: number;
  warrantyMonths: number;
};

/** «Заказ»: что делаем и существенные условия (`orderFacts`); мастер — в своём блоке, поэтому его строки здесь нет. */
export function orderRows(o: OrderInput): { label: string; value: string }[] {
  const facts = orderFacts({ viewer: "CLIENT", ...o }).filter((f) => f.label !== ru.deal.view.executor);
  return [{ label: t.order.what, value: o.title }, ...facts];
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

/** Документы сделки: название с номером, статус подписи («Ждёт вашей подписи», если не хватает вашей; у выписки — без подписи), PDF. */
export function documentRows(docs: readonly DocumentInput[]): DocumentRow[] {
  const d = t.documents;
  return docs.map((doc) => {
    const name = d.name(d.kinds[doc.kind], doc.number);
    const yours = doc.signable && doc.status === "SIGNING" && (doc.canSign.hand || doc.canSign.ecp);
    // Выписка и расписка не подписываются: статус «ждёт подписей» у них ничего не значит.
    const status = !doc.signable ? d.status.NOT_REQUIRED : yours ? d.yours : d.status[doc.status];
    return { id: doc.id, name, status, href: doc.pdfUrl };
  });
}

/** Сколько последних событий видно, пока история свёрнута. */
export const HISTORY_SHOWN = 5;

/** События сделки для `Timeline`: свежие сверху; свёрнутая — последние `HISTORY_SHOWN`. */
export function historyView(history: readonly { id: string; action: string; createdAt: Date }[], all: boolean): { items: { title: string; time: string }[]; more: boolean } {
  const h = t.history;
  const fresh = [...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const shown = all ? fresh : fresh.slice(0, HISTORY_SHOWN);
  return {
    items: shown.map((e) => ({ title: h.action[e.action] ?? h.other, time: formatDateTime(e.createdAt) })),
    more: !all && fresh.length > HISTORY_SHOWN,
  };
}
