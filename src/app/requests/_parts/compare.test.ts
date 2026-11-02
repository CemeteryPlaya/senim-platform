import { describe, expect, it } from "vitest";
import { compareOffers, type ComparableOffer } from "./compare";

const offer = (id: string, price: number, durationDays: number, ratingAvg = 0, reviewsCount = 0, status: ComparableOffer["status"] = "SENT"): ComparableOffer => ({
  id,
  status,
  price,
  durationDays,
  executor: { label: `Исполнитель №${id}`, ratingAvg, reviewsCount },
});

describe("сравнение откликов", () => {
  it("меньше двух действующих откликов — сравнивать нечего", () => {
    expect(compareOffers([])).toBeNull();
    expect(compareOffers([offer("1", 100, 10)])).toBeNull();
    expect(compareOffers([offer("1", 100, 10), offer("2", 90, 9, 0, 0, "DECLINED")])).toBeNull();
  });

  it("лучшая цена, самый короткий срок и рейтинг — у разных исполнителей", () => {
    const result = compareOffers([offer("1", 900_000, 30, 4.2, 3), offer("2", 1_100_000, 20, 4.9, 12), offer("3", 950_000, 25)]);
    expect(result).toEqual({
      cheapest: { id: "1", label: "Исполнитель №1", value: 900_000 },
      fastest: { id: "2", label: "Исполнитель №2", value: 20 },
      topRated: { id: "2", label: "Исполнитель №2", value: 4.9 },
    });
  });

  it("рейтинг без отзывов не сравнивается; отклонённые отклики не участвуют", () => {
    const result = compareOffers([offer("1", 500, 10), offer("2", 600, 12), offer("3", 100, 1, 5, 9, "DECLINED")]);
    expect(result?.topRated).toBeNull();
    expect(result?.cheapest.id).toBe("1");
    expect(result?.fastest.id).toBe("1");
  });
});
