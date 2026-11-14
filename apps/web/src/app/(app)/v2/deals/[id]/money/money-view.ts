import type { DocumentKind } from "@/generated/prisma/enums";
import { formatDateTime } from "@/features/format/format";
import { formatMoney } from "@/kit";
import { ru } from "@/i18n/ru";
import type { MoneyHistoryItem } from "@/modules/payments";

const t = ru.app.deal.money;
const tm = ru.app.masterMoney;

/** Строка истории денег покупателя: показанная запись журнала или свёрнутые записи раздела денег. */
export type OperationRow = {
  /** Записи журнала (`MoneyTransaction.id`), которые строка показывает или сворачивает в себя. */
  covers: string[];
  /** Что за строка: оплата, возврат, остановка выплаты, снятие остановки, выплата мастеру. */
  kind: "hold" | "refund" | "freeze" | "unfreeze" | "payout";
  title: string;
  time: string;
  /** Номер операции банка и пояснения — одной строкой через « · ». */
  text?: string;
  /** Сумма записи журнала; у неудачной оплаты, остановки выплаты и свёрнутой строки завершения суммы нет. */
  amount?: bigint;
  /** Документ-основание операции, если есть: PDF и подпись ссылки по виду документа («Открыть оферту»). */
  basis: { documentId: string; href: string; label: string } | null;
};

/** PDF документа сделки (обработчик общий с v1). */
export const documentPdfHref = (documentId: string) => `/api/documents/${encodeURIComponent(documentId)}/pdf`;

const isSplit = (type: string) => type === "SPLIT_MASTER" || type === "SPLIT_PLATFORM";

/** Основание — документ сделки известного вида (`kinds` — виды документов сделки по id); неизвестный — без ссылки. */
function basisOf(documentId: string | null, kinds: ReadonlyMap<string, DocumentKind>): OperationRow["basis"] {
  const kind = documentId ? kinds.get(documentId) : undefined;
  return documentId && kind ? { documentId, href: documentPdfHref(documentId), label: ru.app.deal.openDocument[kind] } : null;
}

/** Заголовок оплаты по состоянию в банке; при переводе по реквизитам ожидание — «Ждём ваш перевод». */
function holdTitle(status: MoneyHistoryItem["status"], manual: boolean): string {
  if (status === "SUCCEEDED") return t.type.HOLD ?? "";
  if (status === "FAILED") return t.hold.FAILED ?? "";
  return (manual ? t.hold.WAITING : t.hold.PENDING) ?? "";
}

function refundTitle(status: MoneyHistoryItem["status"], split: boolean): string {
  if (status === "SUCCEEDED") return split ? t.refundSplit : (t.type.REFUND ?? "");
  return t.refundState[status] ?? "";
}

/**
 * Последняя попытка каждой части выплаты (повтор после отказа банка — та же часть с новым ключом; как `partsOf` в
 * `payments/projection.ts`, но у записей истории нет `parentId`, поэтому по порядку журнала).
 */
function lastAttempts(splits: readonly MoneyHistoryItem[]): MoneyHistoryItem[] {
  return (["SPLIT_MASTER", "SPLIT_PLATFORM"] as const).flatMap((type) => splits.filter((item) => item.type === type).slice(-1));
}

/**
 * Записи журнала → строки истории денег ПОКУПАТЕЛЯ, свежие сверху. Показывается только движение его денег:
 * - оплата (`HOLD`) и возврат (`REFUND`) — со своими суммами из журнала; заголовок зависит от состояния операции в банке
 *   (обрабатывается / не прошла / проведена); возврат при разделе спора, когда остальное ушло мастеру, — «Спор решён:
 *   возвращено вам»; сумму неудачной оплаты не выводим; `manual` — оплата переводом по реквизитам;
 * - остановка и снятие остановки выплаты (`FREEZE`, `UNFREEZE`) — без суммы (сумма записи — часть, предназначенная мастеру);
 * - записи раздела денег (`SPLIT_MASTER`, `SPLIT_PLATFORM`: доля мастера и доход сервиса) в отдельные строки не выводятся —
 *   они сворачиваются в ОДНУ строку без суммы, чьё состояние берётся по последним попыткам частей (отказ и успешный повтор
 *   дают «Оплата переведена мастеру»). Служебную группу `RELEASE` модуль в историю не отдаёт.
 * Ничего не вычисляется; пометка тестового платежа не выводится.
 */
export function operationRows(history: readonly MoneyHistoryItem[], opts: { manual?: boolean; kinds?: ReadonlyMap<string, DocumentKind> } = {}): OperationRow[] {
  const manual = opts.manual ?? false;
  const kinds = opts.kinds ?? new Map<string, DocumentKind>();
  const splits = history.filter((item) => isSplit(item.type));
  const hasRefund = history.some((item) => item.type === "REFUND");
  const entries: { order: number; row: OperationRow }[] = [];

  history.forEach((item, index) => {
    if (isSplit(item.type)) return;
    const ref = item.operationRef ? t.bankRef(item.operationRef) : undefined;
    const base = { covers: [item.id], time: formatDateTime(item.at), ...(ref ? { text: ref } : {}), basis: basisOf(item.basisDocumentId, kinds) };
    let row: OperationRow;
    switch (item.type) {
      case "HOLD":
        row = { ...base, kind: "hold", title: holdTitle(item.status, manual), ...(item.status === "FAILED" ? {} : { amount: item.amountTiyn }) };
        break;
      case "REFUND":
        row = { ...base, kind: "refund", title: refundTitle(item.status, splits.length > 0), ...(item.status === "FAILED" ? {} : { amount: item.amountTiyn }) };
        break;
      case "FREEZE":
        row = { ...base, kind: "freeze", title: t.type.FREEZE ?? "" };
        break;
      default:
        row = { ...base, kind: "unfreeze", title: t.type.UNFREEZE ?? "" };
    }
    entries.push({ order: index, row });
  });

  if (splits.length > 0) {
    const parts = lastAttempts(splits);
    const last = parts.reduce((a, b) => (b.at.getTime() >= a.at.getTime() ? b : a));
    const state = parts.some((p) => p.status === "FAILED") ? "FAILED" : parts.some((p) => p.status === "PENDING") ? "PENDING" : "SUCCEEDED";
    const title =
      state === "SUCCEEDED" ? (hasRefund ? t.payoutRest : t.payout) : state === "FAILED" ? t.payoutState.FAILED : hasRefund ? t.payoutState.PENDING_REST : t.payoutState.PENDING;
    entries.push({
      order: history.indexOf(last),
      row: {
        covers: splits.map((item) => item.id),
        kind: "payout",
        title: title ?? "",
        time: formatDateTime(last.at),
        basis: basisOf(splits.find((item) => item.basisDocumentId)?.basisDocumentId ?? null, kinds),
      },
    });
  }

  return entries.sort((a, b) => b.order - a.order).map((entry) => entry.row);
}

/** Сумма и состояние оплаты мастеру — по последней попытке части `SPLIT_MASTER` (повтор после отказа — та же часть). */
function masterPayoutRow(history: readonly MoneyHistoryItem[], splits: readonly MoneyHistoryItem[], hasRefund: boolean): { order: number; row: OperationRow } {
  const mine = splits.filter((item) => item.type === "SPLIT_MASTER").slice(-1)[0];
  const last = mine ?? splits.reduce((a, b) => (b.at.getTime() >= a.at.getTime() ? b : a));
  const state = mine?.status ?? "PENDING";
  const p = tm.payout;
  const title = state === "FAILED" ? p.FAILED : state === "PENDING" ? (hasRefund ? p.PENDING_PART : p.PENDING) : hasRefund ? p.DONE_PART : p.DONE;
  return {
    order: history.indexOf(last),
    row: {
      covers: splits.map((item) => item.id),
      kind: "payout",
      title,
      time: formatDateTime(last.at),
      ...(mine?.operationRef ? { text: tm.bankRef(mine.operationRef) } : {}),
      // Сумма — оплата мастеру из журнала; у неудачной попытки суммы нет. Доход сервиса в свёрнутой строке без суммы.
      ...(mine && state !== "FAILED" ? { amount: mine.amountTiyn } : {}),
      basis: null,
    },
  };
}

/**
 * Записи журнала → строки истории денег МАСТЕРА, свежие сверху. Показывается движение денег, которое касается мастера:
 * - оплата покупателя (`HOLD`) — без суммы покупателя (в ней его защита сделки 2%): «Деньги покупателя в банке под защитой»,
 *   под ней — «Вы получите N» (смета мастера модуля, `youGetTiyn`; пока оплата вам не раскрыта), «обрабатывается» / «не прошла»;
 * - остановка и снятие остановки оплаты спором (`FREEZE`, `UNFREEZE`) — без суммы;
 * - оплата мастеру (`SPLIT_MASTER`) — со своей суммой из журнала и статусом банка (номер операции — в тексте); доход сервиса
 *   (`SPLIT_PLATFORM`) в отдельную строку не выводится — он свёрнут в эту же строку и без суммы;
 * - возврат покупателю (`REFUND`) — одна свёрнутая строка без суммы (в ней защита сделки покупателя).
 * Документов-оснований у строк мастера нет: оферта и акт показывают суммы покупателя. Ничего не вычисляется.
 */
export function masterOperationRows(history: readonly MoneyHistoryItem[], opts: { manual?: boolean; youGetTiyn?: bigint | null } = {}): OperationRow[] {
  const manual = opts.manual ?? false;
  const youGet = opts.youGetTiyn ?? null;
  const splits = history.filter((item) => isSplit(item.type));
  const hasRefund = history.some((item) => item.type === "REFUND");
  const entries: { order: number; row: OperationRow }[] = [];

  history.forEach((item, index) => {
    if (isSplit(item.type)) return;
    const base = { covers: [item.id], time: formatDateTime(item.at), basis: null };
    switch (item.type) {
      case "HOLD": {
        const title = item.status === "SUCCEEDED" ? tm.hold.DONE : item.status === "FAILED" ? tm.hold.FAILED : manual ? tm.hold.WAITING : tm.hold.PENDING;
        const showYouGet = item.status === "SUCCEEDED" && youGet !== null;
        entries.push({ order: index, row: { ...base, kind: "hold", title, ...(showYouGet ? { text: tm.youGet(formatMoney(youGet)) } : {}) } });
        break;
      }
      case "REFUND": {
        const r = tm.refund;
        const title = item.status === "FAILED" ? r.FAILED : item.status === "PENDING" ? (splits.length > 0 ? r.PENDING_REST : r.PENDING) : splits.length > 0 ? r.DONE_REST : r.DONE;
        entries.push({ order: index, row: { ...base, kind: "refund", title } });
        break;
      }
      case "FREEZE":
        entries.push({ order: index, row: { ...base, kind: "freeze", title: tm.freeze } });
        break;
      default:
        entries.push({ order: index, row: { ...base, kind: "unfreeze", title: tm.unfreeze } });
    }
  });

  if (splits.length > 0) entries.push(masterPayoutRow(history, splits, hasRefund));
  return entries.sort((a, b) => b.order - a.order).map((entry) => entry.row);
}
