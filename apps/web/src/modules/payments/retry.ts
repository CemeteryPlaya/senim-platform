import { z } from "zod";
import type { MoneyTransaction } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, lockDealRow, transaction, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { requireOperator } from "./access";
import { enqueueExecution, executeDealOperations, type SettledHook } from "./execute";
import { attemptKey, isRetriableType, RETRIABLE_TYPES, type RetriableType } from "./keys";
import { recordOperation } from "./ledger";
import { partsOf, retryCheck, type RetryCheck } from "./projection";

/**
 * Повтор операции после отказа банка (ADR-009, «Повторы операций»). Решение о выходе денег (отмена, акт,
 * решение спора) отказом банка не отменяется: оператор повторяет операцию новой попыткой со своим ключом
 * (`refund:<dealId>:2`), прежняя FAILED остаётся в журнале. Раскрытие повторяется вместе с частями выплаты
 * (их прежние попытки отклонены вместе с ним); часть выплаты при подтверждённом раскрытии — сама,
 * под тем же раскрытием: распоряжение банк уже принял, отказ был по выплате (например, неверный IBAN).
 */

export const retryOperationSchema = z.object({ transactionId: z.string().trim().min(1).max(64) });

const e = ru.payments.errors;
const REFUSAL: Record<Exclude<RetryCheck, "retriable" | "superseded">, string> = {
  notFailed: e.notFailed,
  notRetriable: e.notRetriable,
  parentNotSettled: e.parentNotSettled,
};

/** Следующая попытка операции: та же сумма, основание и спор; номер — по числу попыток этого типа. */
async function nextAttempt(tx: Tx, failed: MoneyTransaction & { type: RetriableType }, all: readonly MoneyTransaction[], parentId: string | null, actorId: string) {
  const n = all.filter((t) => t.type === failed.type).length + 1;
  const { entry } = await recordOperation(tx, {
    dealId: failed.dealId,
    type: failed.type,
    amountTiyn: failed.amountTiyn,
    idempotencyKey: attemptKey[failed.type](failed.dealId, n),
    provider: failed.provider,
    isTest: failed.isTest,
    parentId: parentId ?? undefined,
    disputeId: failed.disputeId ?? undefined,
    basisDocumentId: failed.basisDocumentId,
    actorId,
  });
  return entry;
}

const retriable = <T extends Pick<MoneyTransaction, "type">>(t: T): t is T & { type: RetriableType } => isRetriableType(t.type);

/**
 * Новые попытки в транзакции под блокировкой сделки. Операцию уже повторили (двойной клик, второй оператор) —
 * created: false и ничего нового: повтор считается по последней попытке типа, а не по числу нажатий.
 */
async function retryInTx(tx: Tx, operator: CurrentUser, transactionId: string): Promise<{ dealId: string; created: boolean }> {
  const ref = await tx.moneyTransaction.findUnique({ where: { id: transactionId }, select: { dealId: true } });
  if (!ref) return fail.notFound(e.operationNotFound);
  await lockDealRow(tx, ref.dealId);
  const all = await tx.moneyTransaction.findMany({ where: { dealId: ref.dealId }, orderBy: { seq: "asc" } });
  const failed = all.find((t) => t.id === transactionId)!;
  const check = retryCheck(all, failed);
  if (check === "superseded") return { dealId: ref.dealId, created: false };
  if (check !== "retriable") return fail.conflict(REFUSAL[check]);
  if (!retriable(failed)) return fail.conflict(e.notRetriable);

  const attempt = await nextAttempt(tx, failed, all, failed.parentId, operator.id);
  const attempts = [attempt];
  if (failed.type === "RELEASE") {
    for (const part of partsOf(all, failed).filter(retriable)) attempts.push(await nextAttempt(tx, part, all, attempt.id, operator.id));
  }
  for (const a of attempts) await enqueueExecution(tx, a.dealId, a.idempotencyKey);
  await recordAudit(tx, {
    actor: actorOf(operator),
    action: "payment.operation.retried",
    entity: { type: "moneyTransaction", id: failed.id },
    scope: `deal:${failed.dealId}`,
    before: { status: "FAILED", idempotencyKey: failed.idempotencyKey },
    after: { attempts: attempts.map((a) => a.idempotencyKey) },
    meta: { type: failed.type, error: failed.error },
  });
  return { dealId: ref.dealId, created: true };
}

/** «Повторить операцию» оператора; новые попытки сразу уходят провайдеру сделки (manual — ждут документа). */
export async function retryFailedOperation(operator: CurrentUser, raw: z.input<typeof retryOperationSchema>, onSettled: SettledHook): Promise<{ created: boolean }> {
  requireOperator(operator);
  const { transactionId } = parseInput(retryOperationSchema, raw);
  const { dealId, created } = await transaction((tx) => retryInTx(tx, operator, transactionId));
  if (created) await executeDealOperations(dealId, onSettled);
  return { created };
}

export type FailedOperation = {
  id: string;
  dealId: string;
  dealNumber: number;
  dealTitle: string;
  type: RetriableType;
  amountTiyn: bigint;
  error: string | null;
  failedAt: Date;
};

/** Сколько последних отказов просматривать: повторённые отказы остаются в журнале и отсеиваются здесь. */
const SCAN = 500;

/** Очередь оператора: отклонённые банком операции, которые можно повторить сейчас, — старые сверху. */
export async function listRetriableOperations(operator: CurrentUser): Promise<FailedOperation[]> {
  requireOperator(operator);
  const failed = await db.moneyTransaction.findMany({
    where: { status: "FAILED", type: { in: [...RETRIABLE_TYPES] } },
    orderBy: { seq: "desc" },
    take: SCAN,
    include: { deal: { select: { number: true, title: true } } },
  });
  if (failed.length === 0) return [];
  const related = await db.moneyTransaction.findMany({
    where: { dealId: { in: [...new Set(failed.map((f) => f.dealId))] }, type: { in: [...RETRIABLE_TYPES] } },
    select: { id: true, dealId: true, seq: true, type: true, status: true, parentId: true },
  });
  return failed
    .filter((f) => retryCheck(related.filter((r) => r.dealId === f.dealId), f) === "retriable")
    .filter(retriable)
    .reverse()
    .map((f) => ({ id: f.id, dealId: f.dealId, dealNumber: f.deal.number, dealTitle: f.deal.title, type: f.type, amountTiyn: f.amountTiyn, error: f.error, failedAt: f.settledAt ?? f.createdAt }));
}
