import { describe, expect, it } from "vitest";
import { sortOffers } from "./sort";

const offer = (id: string, price: number, durationDays: number, ratingAvg: number, reviewsCount = 10, minute = 0) => ({
  id,
  priceTiyn: BigInt(price) * 100n,
  durationDays,
  createdAt: new Date(2026, 0, 1, 0, minute),
  executor: { ratingAvg, reviewsCount },
});

describe("сортировка откликов", () => {
  const list = [offer("a", 900, 20, 4.2), offer("b", 1100, 40, 4.9), offer("c", 700, 30, 4.5)];

  it("по цене — сначала дешевле, по сроку — быстрее, по рейтингу — выше", () => {
    expect(sortOffers(list, "price").map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(sortOffers(list, "duration").map((o) => o.id)).toEqual(["a", "c", "b"]);
    expect(sortOffers(list, "rating").map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("при равенстве решают следующие признаки и время отклика; исходный список не меняется", () => {
    const ties = [offer("late", 500, 30, 4.5, 10, 5), offer("slow", 500, 40, 4.5), offer("early", 500, 30, 4.5, 10, 1), offer("more", 900, 30, 4.5, 50)];
    expect(sortOffers(ties, "price").map((o) => o.id)).toEqual(["early", "late", "slow", "more"]);
    expect(sortOffers(ties, "rating").map((o) => o.id)).toEqual(["more", "slow", "early", "late"]);
    expect(ties[0].id).toBe("late");
  });
});
