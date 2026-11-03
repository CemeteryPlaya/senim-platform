import { z } from "zod";
import type { MoneyTransactionType } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { assertAttachable } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, isUniqueViolation, lockDealRow, transaction, type Tx } from "@/platform/db";
import { fail, isAppError } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import type { SettledHook } from "../execute";
import { settle, type BankConfirmation, type Outcome } from "../ledger";
import type { PaymentProvider, ProviderResult } from "../provider";

/**
 * Ручной провайдер — мост к реальному банку (пилот, Freedom Bank: счёт без API, раскрытие по расписке).
 * Платформа ничего не отправляет: каждая операция ждёт, пока оператор подтвердит её номером, датой и сканом
 * банковского документа (confirmManualOperation) или отметит отказ банка (failManualOperation).
 * Вебхуков нет; опрос getStatus для manual не запускается.
 */
const pending = async (): Promise<ProviderResult> => ({ status: "PENDING" });

export const manualProvider: PaymentProvider = {
  name: "manual",
  isTest: false,
  hold: pending,
  release: pending,
  split: async () => ({ master: { status: "PENDING" }, platform: { status: "PENDING" } }),
  refund: pending,
  getStatus: pending,
  handleWebhook: async () => ({ kind: "rejected", reason: "manual provider has no webhooks" }),
};

// ─── оператор: итог операции по банковскому документу ───────────────────────

const v = ru.payments.validation;
const id = z.string().trim().min(1).max(64);

export const confirmManualSchema = z.object({
  transactionId: id,
  bankDocNumber: z.string().trim().min(1, v.bankDocNumber).max(100),
  bankDocDate: z.coerce.date({ error: v.bankDocDate }),
  bankDocFileId: z.string().trim().min(1, v.bankDocFile).max(64),
});

export const failManualSchema = z.object({ transactionId: id, reason: z.string().trim().min(5, v.failReason).max(500) });

const DAY_MS = 24 * 3600 * 1000;

function requireOperator(user: CurrentUser): void {
  if (user.role !== "OPERATOR") fail.forbidden();
}

/** Операция manual, ждущая итога, под блокировкой строки сделки (тот же порядок блокировок, что у deal-core). */
async function lockPendingManual(tx: Tx, transactionId: string) {
  const ref = await tx.moneyTransaction.findUnique({ where: { id: transactionId }, select: { dealId: true } });
  if (!ref) return fail.notFound(ru.payments.errors.operationNotFound);
  await lockDealRow(tx, ref.dealId);
  const op = await tx.moneyTransaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (op.provider !== "MANUAL") return fail.conflict(ru.payments.errors.notManual);
  if (op.status !== "PENDING") return fail.conflict(ru.payments.errors.notPending);
  return op;
}

/**
 * Скан — свой, назначения BANK_DOCUMENT и ещё ни к одной операции не приложен (files.assertAttachable).
 * Для формы оператора — ошибка поля скана (VALIDATION), а не общий CONFLICT.
 */
async function assertBankDoc(tx: Tx, operator: CurrentUser, fileId: string): Promise<void> {
  try {
    await assertAttachable(tx, { fileId, uploadedById: operator.id, purpose: "BANK_DOCUMENT" });
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT") fail.validation(ru.payments.errors.bankDocInvalid, { fieldErrors: { bankDocFileId: [ru.payments.errors.bankDocInvalid] } });
    throw e;
  }
}

async function finish(tx: Tx, operator: CurrentUser, op: { id: string; dealId: string; type: MoneyTransactionType }, outcome: Outcome, confirmation: BankConfirmation | undefined, onSettled: SettledHook) {
  const settled = await settle(tx, op.id, outcome, confirmation);
  await recordAudit(tx, {
    actor: actorOf(operator),
    action: outcome.status === "SUCCEEDED" ? "payment.operation.confirmed" : "payment.operation.failed",
    entity: { type: "moneyTransaction", id: op.id },
    scope: `deal:${op.dealId}`,
    before: { status: "PENDING" },
    after: { status: settled.status, type: settled.type, amountTiyn: settled.amountTiyn.toString() },
    meta: confirmation
      ? { bankDocNumber: confirmation.bankDocNumber, bankDocDate: confirmation.bankDocDate.toISOString(), bankDocFileId: confirmation.bankDocFileId }
      : { reason: outcome.status === "FAILED" ? outcome.error : null },
  });
  await onSettled(tx, settled);
}

/**
 * «Деньги поступили на счёт в банке», «Выплачено мастеру», «Доход платформы получен», «Возврат покупателю»:
 * оператор подтверждает операцию номером, датой и сканом банковского документа — всё в журнал аудита.
 * Двойной клик — CONFLICT: итог записывается только из PENDING.
 */
export async function confirmManualOperation(operator: CurrentUser, raw: z.input<typeof confirmManualSchema>, onSettled: SettledHook): Promise<void> {
  requireOperator(operator);
  const input = parseInput(confirmManualSchema, raw);
  if (input.bankDocDate.getTime() > Date.now() + DAY_MS) fail.validation(ru.payments.errors.bankDocInFuture);
  try {
    await transaction(async (tx) => {
      const op = await lockPendingManual(tx, input.transactionId);
      await assertBankDoc(tx, operator, input.bankDocFileId);
      const confirmation = { confirmedById: operator.id, bankDocNumber: input.bankDocNumber, bankDocDate: input.bankDocDate, bankDocFileId: input.bankDocFileId };
      await finish(tx, operator, op, { status: "SUCCEEDED", externalRef: input.bankDocNumber }, confirmation, onSettled);
    });
  } catch (e) {
    // Тот же скан параллельно приложили к другой операции: уникальный индекс bankDocFileId.
    if (isUniqueViolation(e)) fail.validation(ru.payments.errors.bankDocInvalid);
    throw e;
  }
}

/** Банк отказал: операция FAILED с причиной; дальше решает владелец сделки (уведомления, повтор). */
export async function failManualOperation(operator: CurrentUser, raw: z.input<typeof failManualSchema>, onSettled: SettledHook): Promise<void> {
  requireOperator(operator);
  const input = parseInput(failManualSchema, raw);
  await transaction(async (tx) => {
    const op = await lockPendingManual(tx, input.transactionId);
    await finish(tx, operator, op, { status: "FAILED", error: input.reason }, undefined, onSettled);
  });
}

export type PendingManualOperation = {
  id: string;
  dealId: string;
  dealNumber: number;
  dealTitle: string;
  type: MoneyTransactionType;
  amountTiyn: bigint;
  createdAt: Date;
};

/** Очередь оператора: операции manual, ждущие банковского документа, — старые сверху. */
export async function listPendingManualOperations(operator: CurrentUser): Promise<PendingManualOperation[]> {
  requireOperator(operator);
  const rows = await db.moneyTransaction.findMany({
    where: { provider: "MANUAL", status: "PENDING" },
    orderBy: { seq: "asc" },
    take: 200,
    include: { deal: { select: { number: true, title: true } } },
  });
  return rows.map((r) => ({ id: r.id, dealId: r.dealId, dealNumber: r.deal.number, dealTitle: r.deal.title, type: r.type, amountTiyn: r.amountTiyn, createdAt: r.createdAt }));
}
