import { ru } from "@/i18n/ru";
import { db, type Db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { costUsdMicros } from "./pricing";
import type { AiProvider, AiUsageInfo } from "./provider";

export type AiOperation = "request.assist" | "request.visualize";

/**
 * Учёт каждой операции ИИ: провайдер, модель, токены/изображения и стоимость по таблице цен.
 * Пишется сразу после ответа провайдера — потраченное учитывается, даже если ответ потом отклонён.
 */
export async function recordUsage(
  client: Db,
  input: { provider: AiProvider["name"]; operation: AiOperation; usage: AiUsageInfo; requestId: string; userId: string },
): Promise<number> {
  const cost = costUsdMicros(input.usage);
  await client.aiUsage.create({
    data: {
      provider: input.provider,
      operation: input.operation,
      model: input.usage.model,
      requestId: input.requestId,
      userId: input.userId,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      images: input.usage.images,
      costUsdMicros: cost,
    },
  });
  return cost;
}

const DAY_MS = 24 * 3600_000;

/**
 * Суточный потолок расходов ИИ на всю платформу (AI_DAILY_BUDGET_USD, скользящие 24 часа):
 * защита от счёта провайдера при всплеске или злоупотреблении. Проверяется перед каждым вызовом провайдера.
 */
export async function ensureWithinDailyBudget(client: Db = db): Promise<void> {
  const budgetMicros = Math.round(env().AI_DAILY_BUDGET_USD * 1_000_000);
  const spent = await client.aiUsage.aggregate({
    _sum: { costUsdMicros: true },
    where: { createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  if ((spent._sum.costUsdMicros ?? 0) >= budgetMicros) fail.unavailable(ru.ai.errors.dailyBudget);
}
