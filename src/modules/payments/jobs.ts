import { z } from "zod";
import type { JobHandlers } from "@/platform/jobs";
import { parseInput } from "@/platform/validation";
import { executeDealOperations, JOB_EXECUTE_DEAL, type SettledHook } from "./execute";
import { JOB_POLL_PENDING, pollPendingOperations } from "./poll";

const dealPayload = z.object({ dealId: z.string().min(1).max(64) });

/**
 * Задачи payments. Итог операции двигает сделку — это решает её владелец (deal-core), поэтому хук
 * передаёт сборка задач (src/jobs.ts): payments не импортирует deal-core. Обе задачи идемпотентны.
 */
export function paymentJobHandlers(onSettled: SettledHook) {
  return {
    /** Отправить провайдеру ждущие операции сделки (поставлена при записи операции). */
    [JOB_EXECUTE_DEAL]: async (payload) => {
      const { dealId } = parseInput(dealPayload, payload);
      await executeDealOperations(dealId, onSettled);
    },
    /** Опрос PENDING автоматических провайдеров: ставится каждые 10 минут (src/jobs.ts). */
    [JOB_POLL_PENDING]: async (_payload, ctx) => {
      ctx.log.info("payments poll", await pollPendingOperations(onSettled));
    },
  } as const satisfies JobHandlers;
}
