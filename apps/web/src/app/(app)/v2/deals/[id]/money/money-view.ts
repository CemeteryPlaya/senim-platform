import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { MoneyHistoryItem } from "@/modules/payments";

const t = ru.app.deal.money;

/** Строка истории денег покупателя: показанная запись журнала или свёрнутые записи раздела денег. */
export type OperationRow = {
  /** Записи журнала (`MoneyTransaction.id`), которые строка показывает или сворачивает в себя. */
  covers: string[];
  title: string;
  time: string;
  /** Статус банка и номер операции — одной строкой через « · ». */
  text?: string;
  /** Сумма записи журнала; у остановки выплаты и у свёрнутой строки завершения суммы нет. */
  amount?: bigint;
  /** Документ-основание операции, если есть. */
  basis: { documentId: string; href: string } | null;
};

/** PDF документа сделки (обработчик общий с v1). */
export const documentPdfHref = (documentId: string) => `/api/documents/${encodeURIComponent(documentId)}/pdf`;

const isSplit = (type: string) => type === "SPLIT_MASTER" || type === "SPLIT_PLATFORM";

const basisOf = (documentId: string | null): OperationRow["basis"] => (documentId ? { documentId, href: documentPdfHref(documentId) } : null);

/**
 * Записи журнала → строки истории денег ПОКУПАТЕЛЯ, свежие сверху. Показывается только движение его денег:
 * - оплата (`HOLD`) и возврат (`REFUND`) — со своими суммами из журнала; возврат при разделе спора, когда остальное ушло
 *   мастеру, называется «Спор решён: возвращено вам»;
 * - остановка и снятие остановки выплаты (`FREEZE`, `UNFREEZE`) — без суммы (сумма записи — часть, предназначенная мастеру);
 * - записи раздела денег (`SPLIT_MASTER`, `SPLIT_PLATFORM`: доля мастера и доход сервиса) в отдельные строки не выводятся —
 *   они сворачиваются в ОДНУ строку «Оплата переведена мастеру» (или «Остальное переведено мастеру») без суммы, с датой
 *   последней из них. Служебную группу `RELEASE` модуль в историю не отдаёт.
 * Ничего не вычисляется; пометка тестового платежа не выводится.
 */
export function operationRows(history: readonly MoneyHistoryItem[]): OperationRow[] {
  const splits = history.filter((item) => isSplit(item.type));
  const hasRefund = history.some((item) => item.type === "REFUND");
  const entries: { order: number; row: OperationRow }[] = [];

  history.forEach((item, index) => {
    if (isSplit(item.type)) return;
    const parts = [item.status === "SUCCEEDED" ? undefined : t.status[item.status], item.operationRef ? t.bankRef(item.operationRef) : undefined].filter(
      (x): x is string => Boolean(x),
    );
    const title = item.type === "REFUND" && splits.length > 0 ? t.refundSplit : (t.type[item.type] ?? t.type.HOLD);
    entries.push({
      order: index,
      row: {
        covers: [item.id],
        title,
        time: formatDateTime(item.at),
        ...(parts.length > 0 ? { text: parts.join(" · ") } : {}),
        ...(item.type === "FREEZE" || item.type === "UNFREEZE" ? {} : { amount: item.amountTiyn }),
        basis: basisOf(item.basisDocumentId),
      },
    });
  });

  if (splits.length > 0) {
    const last = splits.reduce((a, b) => (b.at.getTime() >= a.at.getTime() ? b : a));
    const pending = splits.find((item) => item.status !== "SUCCEEDED");
    entries.push({
      order: history.indexOf(last),
      row: {
        covers: splits.map((item) => item.id),
        title: hasRefund ? t.payoutRest : t.payout,
        time: formatDateTime(last.at),
        ...(pending ? { text: t.status[pending.status] } : {}),
        basis: basisOf(splits.find((item) => item.basisDocumentId)?.basisDocumentId ?? null),
      },
    });
  }

  return entries.sort((a, b) => b.order - a.order).map((entry) => entry.row);
}
