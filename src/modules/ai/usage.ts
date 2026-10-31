import { ru } from "@/i18n/ru";
import { db, transaction, type Db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { costUsdMicros } from "./pricing";
import type { AiProvider, AiUsageInfo } from "./provider";

export type AiOperation = "request.assist" | "request.visualize";

const DAY_MS = 24 * 3600_000;
const budgetMicros = () => Math.round(env().AI_DAILY_BUDGET_USD * 1_000_000);

async function spentToday(client: Db): Promise<number> {
  const spent = await client.aiUsage.aggregate({
    _sum: { costUsdMicros: true },
    where: { createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  return spent._sum.costUsdMicros ?? 0;
}

/**
 * Суточный потолок расходов ИИ на всю платформу (AI_DAILY_BUDGET_USD, скользящие 24 часа):
 * защита от счёта провайдера при всплеске или злоупотреблении. Быстрая проверка при приёме заказа;
 * перед самим вызовом провайдера бюджет резервируется (reserveUsage).
 */
export async function ensureWithinDailyBudget(client: Db = db): Promise<void> {
  if ((await spentToday(client)) >= budgetMicros()) fail.unavailable(ru.ai.errors.dailyBudget);
}

/** Оценка вызова сверху: столько резервируется до ответа (цена — по таблице pricing.ts для модели). */
const ESTIMATE: Record<AiOperation, Omit<AiUsageInfo, "model">> = {
  "request.assist": { inputTokens: 4_000, outputTokens: 1_000 },
  "request.visualize": { images: 1 },
};

function estimatedUsage(provider: AiProvider["name"], operation: AiOperation): AiUsageInfo {
  const text = operation === "request.assist";
  const e = env();
  const model = provider === "mock" ? (text ? "mock/text" : "mock/image") : ((text ? e.AI_TEXT_MODEL : e.AI_IMAGE_MODEL) ?? "unknown");
  return { model, ...ESTIMATE[operation] };
}

/** Ключ advisory-блокировки: проверка бюджета и запись резерва идут по очереди на всю платформу. */
const BUDGET_LOCK = "ai.daily-budget";

/**
 * Резерв в суточном бюджете до вызова провайдера (security №8): проверка остатка и запись оценки
 * в AiUsage под одной advisory-блокировкой. Иначе параллельные вызовы проходят проверку вместе,
 * пока ни один ещё не записал расход. Возвращает id записи — её уточняет settleUsage после ответа.
 * Вызов провайдера, упавший после резерва, оставляет оценку: потрачено ли что-то, неизвестно.
 */
export async function reserveUsage(input: { provider: AiProvider["name"]; operation: AiOperation; requestId: string; userId: string }): Promise<string> {
  const estimate = estimatedUsage(input.provider, input.operation);
  const cost = costUsdMicros(estimate);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BUDGET_LOCK}))`;
    const spent = await spentToday(tx);
    if (spent >= budgetMicros() || spent + cost > budgetMicros()) return fail.unavailable(ru.ai.errors.dailyBudget);
    const row = await tx.aiUsage.create({
      data: { provider: input.provider, operation: input.operation, model: estimate.model, requestId: input.requestId, userId: input.userId, costUsdMicros: cost },
    });
    return row.id;
  });
}

/**
 * Учёт операции: фактические модель, токены/изображения и стоимость по таблице цен вместо оценки.
 * Пишется сразу после ответа провайдера — потраченное учитывается, даже если ответ потом отклонён.
 */
export async function settleUsage(reservationId: string, usage: AiUsageInfo): Promise<number> {
  const cost = costUsdMicros(usage);
  await db.aiUsage.update({
    where: { id: reservationId },
    data: { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, images: usage.images, costUsdMicros: cost },
  });
  return cost;
}
