import type { MoneyTransactionType } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { onMoneySettled } from "@/modules/deal-core";
import { saveFile } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { confirmManualOperation, failManualOperation, listPendingManualOperations, type PendingManualOperation } from "@/modules/payments";
import { fail } from "@/platform/errors";
import { assertOperator } from "./access";

/**
 * Кнопки провайдера manual (ТЗ п. 10): оператор отмечает, что сделал банк, по банковскому документу.
 * Проверки, идемпотентность («только из PENDING»), журнал денег и аудит — в payments; переход сделки —
 * хук deal-core.onMoneySettled, который подключается здесь, а не на экране.
 */

/** Операции, которые оператор подтверждает кнопкой; FREEZE/UNFREEZE записываются сразу выполненными. */
export type ManualOperationType = Exclude<MoneyTransactionType, "FREEZE" | "UNFREEZE">;

export const isManualType = (type: MoneyTransactionType): type is ManualOperationType => type !== "FREEZE" && type !== "UNFREEZE";

export type MoneyQueueItem = PendingManualOperation & { type: ManualOperationType; ageDays: number };

const DAY_MS = 86_400_000;

/** Очередь ждущих операций manual — старые сверху; сколько дней ждёт документа. */
export async function listMoneyQueue(operator: CurrentUser, now = new Date()): Promise<MoneyQueueItem[]> {
  assertOperator(operator);
  const rows = await listPendingManualOperations(operator);
  return rows.flatMap(({ type, ...r }) => (isManualType(type) ? [{ ...r, type, ageDays: Math.floor((now.getTime() - r.createdAt.getTime()) / DAY_MS) }] : []));
}

export async function confirmBankOperation(
  operator: CurrentUser,
  input: { transactionId: string; bankDocNumber: string; bankDocDate: Date; bankDocFileId: string },
): Promise<void> {
  assertOperator(operator);
  await confirmManualOperation(operator, input, onMoneySettled);
}

export async function failBankOperation(operator: CurrentUser, input: { transactionId: string; reason: string }): Promise<void> {
  assertOperator(operator);
  await failManualOperation(operator, input, onMoneySettled);
}

// ─── скан банковского документа ──────────────────────────────────────────────


/**
 * Скан (PDF, JPEG, PNG) сохраняется как StoredFile назначения BANK_DOCUMENT, загруженный оператором;
 * к операции его прикладывает payments.confirmManualOperation (один скан — одна операция).
 */
export async function saveBankDocument(operator: CurrentUser, bytes: Uint8Array): Promise<string> {
  assertOperator(operator);
  if (bytes.length === 0) return fail.validation(ru.payments.validation.bankDocFile, { fieldErrors: { scan: [ru.payments.validation.bankDocFile] } });
  // Тип, размер и очистку метаданных проверяет files по PURPOSE_POLICY.BANK_DOCUMENT (только оператор, фото или PDF).
  return (await saveFile({ purpose: "BANK_DOCUMENT", bytes, uploadedById: operator.id })).id;
}
