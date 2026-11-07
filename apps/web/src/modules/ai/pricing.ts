import type { AiUsageInfo } from "./provider";

/**
 * Таблица цен ИИ-операций в миллионных долях доллара (micro-USD): за 1 млн входных и выходных
 * токенов и за одно изображение. Единственное место, где считается стоимость.
 *
 * Реальный провайдер владелец ещё не выбрал. Когда модели в AI_TEXT_MODEL / AI_IMAGE_MODEL
 * будут заданы, сюда добавляются строки с ценами из прайса провайдера. До тех пор неизвестная
 * модель оценивается сверху (FALLBACK), чтобы учёт не показывал «бесплатно».
 */
export type Price = { inputPerMTok: number; outputPerMTok: number; perImage: number };

const FREE: Price = { inputPerMTok: 0, outputPerMTok: 0, perImage: 0 };

const PRICES: Readonly<Record<string, Price>> = {
  "mock/text": FREE,
  "mock/image": FREE,
};

/** Оценка сверху для модели без строки в таблице: $5 / $25 за 1 млн токенов, $0,10 за изображение. */
const FALLBACK: Price = { inputPerMTok: 5_000_000, outputPerMTok: 25_000_000, perImage: 100_000 };

export function priceOf(model: string): Price {
  return PRICES[model] ?? FALLBACK;
}

export function costUsdMicros(usage: AiUsageInfo): number {
  const p = priceOf(usage.model);
  const tokens = (usage.inputTokens ?? 0) * p.inputPerMTok + (usage.outputTokens ?? 0) * p.outputPerMTok;
  return Math.ceil(tokens / 1_000_000 + (usage.images ?? 0) * p.perImage);
}
