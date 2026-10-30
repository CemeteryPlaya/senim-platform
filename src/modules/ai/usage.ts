import type { Db } from "@/platform/db";
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
