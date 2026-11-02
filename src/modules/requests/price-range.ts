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

export function priceRange(prices: readonly number[]): PriceRange | null {
  if (prices.length < PRICE_RANGE_MIN_COUNT) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const from = Math.floor(percentile(sorted, 0.25) / STEP) * STEP;
  const to = Math.ceil(percentile(sorted, 0.75) / STEP) * STEP;
  return { from, to: Math.max(to, from + STEP), count: prices.length };
}
