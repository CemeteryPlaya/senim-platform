import type { OfferSort } from "./schema";

export type Sortable = { price: number; durationDays: number; createdAt: Date; executor: { ratingAvg: number; reviewsCount: number } };

type Compare = (a: Sortable, b: Sortable) => number;

const byPrice: Compare = (a, b) => a.price - b.price;
const byDuration: Compare = (a, b) => a.durationDays - b.durationDays;
const byRating: Compare = (a, b) => b.executor.ratingAvg - a.executor.ratingAvg || b.executor.reviewsCount - a.executor.reviewsCount;
const byTime: Compare = (a, b) => a.createdAt.getTime() - b.createdAt.getTime();

const ORDER: Record<OfferSort, Compare[]> = {
  price: [byPrice, byDuration, byTime],
  duration: [byDuration, byPrice, byTime],
  rating: [byRating, byPrice, byTime],
};

/** Отклики по выбранному порядку; при равенстве — дешевле или быстрее, затем раньше присланный. */
export function sortOffers<T extends Sortable>(offers: readonly T[], sort: OfferSort): T[] {
  const chain = ORDER[sort];
  return [...offers].sort((a, b) => {
    for (const cmp of chain) {
      const d = cmp(a, b);
      if (d !== 0) return d;
    }
    return 0;
  });
}
