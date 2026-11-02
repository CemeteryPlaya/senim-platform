import { randomUUID } from "node:crypto";
import type { MoneyTransactionType } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { onMoneySettled } from "@/modules/deal-core";
import { sniffType, storage } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { confirmManualOperation, failManualOperation, listPendingManualOperations, type PendingManualOperation } from "@/modules/payments";
import { sha256Hex } from "@/platform/crypto";
import { db } from "@/platform/db";
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

const MAX_SCAN_BYTES = 4 * 1024 * 1024; // предел тела Server Action (next.config: serverActions.bodySizeLimit)
const SCAN_TYPES = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png" } as const;

/**
 * Скан (PDF, JPEG, PNG) сохраняется как StoredFile назначения BANK_DOCUMENT, загруженный оператором;
 * к операции его прикладывает payments.confirmManualOperation (один скан — одна операция).
 * INTEGRATOR: заменить на files.saveFile({ purpose: "BANK_DOCUMENT", bytes, uploadedById }), когда в
 * files.PURPOSE_POLICY появится BANK_DOCUMENT (imageOrPdf, роль OPERATOR), или на Uploader с этим назначением.
 * Адаптер не перекодирует картинку (EXIF остаётся): скан банковского документа не фото человека.
 */
export async function saveBankDocument(operator: CurrentUser, bytes: Uint8Array): Promise<string> {
  assertOperator(operator);
  const v = ru.operator.money.validation;
  if (bytes.length === 0) return fail.validation(ru.payments.validation.bankDocFile, { fieldErrors: { scan: [ru.payments.validation.bankDocFile] } });
  if (bytes.length > MAX_SCAN_BYTES) return fail.validation(v.scanTooLarge, { fieldErrors: { scan: [v.scanTooLarge] } });
  const kind = sniffType(bytes);
  if (kind !== "pdf" && kind !== "jpeg" && kind !== "png") return fail.validation(v.scanType, { fieldErrors: { scan: [v.scanType] } });
  const provider = await storage();
  const at = new Date();
  const storageKey = `bank_document/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${kind === "jpeg" ? "jpg" : kind}`;
  await provider.put(storageKey, bytes, SCAN_TYPES[kind]);
  const file = await db.storedFile.create({
    data: { storageKey, provider: provider.name, purpose: "BANK_DOCUMENT", contentType: SCAN_TYPES[kind], size: bytes.length, sha256: sha256Hex(bytes), uploadedById: operator.id },
    select: { id: true },
  });
  return file.id;
}
