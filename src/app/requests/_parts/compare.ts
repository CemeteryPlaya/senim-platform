import type { OfferStatus } from "@/generated/prisma/enums";

/** Что нужно для сравнения откликов: цена, срок и рейтинг исполнителя (только настоящие данные). */
export type ComparableOffer = {
  id: string;
  status: OfferStatus;
  price: number;
  durationDays: number;
  executor: { label: string; ratingAvg: number; reviewsCount: number };
};

export type Leader = { id: string; label: string; value: number };
export type OfferComparison = { cheapest: Leader; fastest: Leader; topRated: Leader | null };

/** Отклики, которые ещё можно выбрать или уже выбраны: отклонённые и отозванные не сравниваются. */
const ACTIVE: ReadonlySet<OfferStatus> = new Set(["SENT", "ACCEPTED"]);

function best(offers: readonly ComparableOffer[], value: (o: ComparableOffer) => number, better: (a: number, b: number) => boolean): Leader {
  const top = offers.reduce((a, b) => (better(value(b), value(a)) ? b : a));
  return { id: top.id, label: top.executor.label, value: value(top) };
}

/**
 * Строки «Лучшая цена», «Быстрее всех», «Выше рейтинг» над списком откликов. Сравнивать есть смысл
 * от двух действующих откликов; рейтинг — только у исполнителей с отзывами (иначе null).
 */
export function compareOffers(offers: readonly ComparableOffer[]): OfferComparison | null {
  const active = offers.filter((o) => ACTIVE.has(o.status));
  if (active.length < 2) return null;
  const rated = active.filter((o) => o.executor.reviewsCount > 0);
  return {
    cheapest: best(active, (o) => o.price, (a, b) => a < b),
    fastest: best(active, (o) => o.durationDays, (a, b) => a < b),
    topRated: rated.length > 0 ? best(rated, (o) => o.executor.ratingAvg, (a, b) => a > b) : null,
  };
}
