import type { MoneyTransaction } from "@/generated/prisma/client";
import { db, lockDealRow, transaction } from "@/platform/db";
import { logger } from "@/platform/logger";
import { executeDealOperations, outcomeOf, settleFromProvider, type SettledHook } from "./execute";
import { rememberExternalRef } from "./ledger";
import { AUTOMATIC_KINDS, providerFor } from "./providers";

export const JOB_POLL_PENDING = "payments.pollPending";

/**
 * Опрос ждущих операций автоматических провайдеров (вебхук мог не дойти, вызов — оборваться).
 * Без номера у провайдера — операция до него, возможно, не дошла: отправляем снова тем же ключом.
 * С номером — спрашиваем итог getStatus. manual не опрашивается: его итог вносит оператор.
 */
export async function pollPendingOperations(onSettled: SettledHook, opts: { olderThanMs?: number; limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const pending = await db.moneyTransaction.findMany({
    where: { status: "PENDING", provider: { in: [...AUTOMATIC_KINDS] }, createdAt: { lt: new Date(now.getTime() - (opts.olderThanMs ?? 60_000)) } },
    orderBy: { seq: "asc" },
    take: opts.limit ?? 100,
  });
  const resent = new Set<string>();
  let settled = 0;
  for (const op of pending) {
    try {
      if (await pollOne(op, resent, onSettled)) settled++;
    } catch (error) {
      logger.warn("payment poll failed", { idempotencyKey: op.idempotencyKey, error });
    }
  }
  return { checked: pending.length, settled, resentDeals: resent.size };
}

/** Одна ждущая операция: без номера — отправить сделку снова (раз за проход), с номером — спросить итог. true — итог записан. */
async function pollOne(op: MoneyTransaction, resent: Set<string>, onSettled: SettledHook): Promise<boolean> {
  if (!op.externalRef) {
    if (!resent.has(op.dealId)) {
      resent.add(op.dealId);
      await executeDealOperations(op.dealId, onSettled);
    }
    return false;
  }
  const result = await providerFor(op.provider).getStatus({ idempotencyKey: op.idempotencyKey, externalRef: op.externalRef });
  if (result.status === "PENDING") {
    if (result.externalRef) await rememberExternalRef(db, op.id, result.externalRef);
    return false;
  }
  const done = await transaction(async (tx) => {
    await lockDealRow(tx, op.dealId);
    return settleFromProvider(tx, op.id, outcomeOf(result), "poll", onSettled);
  });
  return done !== null;
}
