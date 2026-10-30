import { db } from "@/platform/db";
import type { JobHandlers } from "@/platform/jobs";
import { logger } from "@/platform/logger";
import { executeOperation, type SettledHook } from "./operations";

/**
 * Досылка зависших денежных операций. Операция может застрять в PENDING, если банк не ответил
 * за все попытки задачи deal-core.settlePayment или потерялся вебхук с итогом. Раз в сутки
 * задача payments.resendPending снова отправляет в банк каждую RELEASE/REFUND в PENDING старше
 * RESEND_AFTER_MINUTES — с тем же ключом идемпотентности: банк вернёт итог уже выполненной
 * операции, а не исполнит её второй раз.
 */
export const JOB_RESEND_PENDING = "payments.resendPending";
export const RESEND_AFTER_MINUTES = 15;

export async function resendPendingOperations(onSettled: SettledHook, now = new Date()): Promise<{ resent: number; failed: number }> {
  const ops = await db.paymentOperation.findMany({
    where: {
      status: "PENDING",
      kind: { in: ["RELEASE", "REFUND"] },
      createdAt: { lt: new Date(now.getTime() - RESEND_AFTER_MINUTES * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    select: { idempotencyKey: true, dealId: true },
  });
  let failed = 0;
  for (const op of ops) {
    try {
      await executeOperation(op.idempotencyKey, onSettled);
    } catch (error) {
      // Одна недоступная операция не мешает остальным; следующая попытка — завтра.
      failed++;
      logger.warn("payment operation still pending", { dealId: op.dealId, operation: op.idempotencyKey, error });
    }
  }
  return { resent: ops.length - failed, failed };
}

/**
 * Задачи payments. Хук итога операции (deal-core.onPaymentSettled) передаёт сборка src/jobs.ts:
 * payments не импортирует deal-core — тот же приём, что у вебхуков.
 */
export function paymentJobHandlers(onSettled: SettledHook) {
  return {
    [JOB_RESEND_PENDING]: async (_payload, ctx) => {
      ctx.log.info("payments.resendPending", await resendPendingOperations(onSettled));
    },
  } as const satisfies JobHandlers;
}
