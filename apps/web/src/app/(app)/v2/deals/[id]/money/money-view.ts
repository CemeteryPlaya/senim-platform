import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { MoneyHistoryItem } from "@/modules/payments";

const t = ru.app.deal.money;

/** Строка истории денег: одна запись журнала — одна строка. */
export type OperationRow = {
  /** Id записи журнала (`MoneyTransaction.id`). */
  id: string;
  title: string;
  time: string;
  /** Пояснение, статус банка, номер операции — одной строкой через « · ». */
  text?: string;
  amount: bigint;
  /** Документ-основание операции, если есть. */
  basis: { documentId: string; href: string } | null;
};

/** PDF документа сделки (обработчик общий с v1). */
export const documentPdfHref = (documentId: string) => `/api/documents/${encodeURIComponent(documentId)}/pdf`;

/**
 * Записи журнала → строки истории словами покупателя, свежие сверху. Служебных записей модуль уже не отдаёт (раскрытие
 * выплаты — группа, в истории её части). Суммы и порядок — из журнала как есть, ничего не считается; пометка тестового
 * платежа не выводится.
 */
export function operationRows(history: readonly MoneyHistoryItem[]): OperationRow[] {
  return [...history].reverse().map((item) => {
    const parts = [t.note[item.type], item.status === "SUCCEEDED" ? undefined : t.status[item.status], item.operationRef ? t.bankRef(item.operationRef) : undefined].filter(
      (x): x is string => Boolean(x),
    );
    return {
      id: item.id,
      title: t.type[item.type] ?? t.type.HOLD,
      time: formatDateTime(item.at),
      ...(parts.length > 0 ? { text: parts.join(" · ") } : {}),
      amount: item.amountTiyn,
      basis: item.basisDocumentId ? { documentId: item.basisDocumentId, href: documentPdfHref(item.basisDocumentId) } : null,
    };
  });
}
