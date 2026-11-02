/**
 * Вилка цены для подсказки на экране «Уровень»: средняя половина цен (от 25-го до 75-го процентиля),
 * округлённая наружу до 10 000 ₸. Меньше трёх цен — вилки нет: одна-две цены — это цены конкретных исполнителей.
 */
export type PriceRange = { from: number; to: number; count: number };

export const PRICE_RANGE_MIN_COUNT = 3;
const STEP = 10_000;

/** Значение по ближайшему рангу: p — доля от 0 до 1. */
function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)];
}

/** Округление вилки наружу до 10 000 ₸; вилка не уже одного шага. Одно правило для откликов и материалов. */
export function roundOutward(low: number, high: number): { from: number; to: number } {
  const from = Math.floor(low / STEP) * STEP;
  const to = Math.ceil(high / STEP) * STEP;
  return { from, to: Math.max(to, from + STEP) };
}

export function priceRange(prices: readonly number[]): PriceRange | null {
  if (prices.length < PRICE_RANGE_MIN_COUNT) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  return { ...roundOutward(percentile(sorted, 0.25), percentile(sorted, 0.75)), count: prices.length };
}
