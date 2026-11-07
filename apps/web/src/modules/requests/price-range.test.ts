import { describe, expect, it } from "vitest";
import { priceRange } from "./price-range";

describe("вилка цены по откликам", () => {
  it("меньше трёх цен — вилки нет", () => {
    expect(priceRange([])).toBeNull();
    expect(priceRange([500_000, 700_000])).toBeNull();
  });

  it("средняя половина цен, округлённая наружу до 10 000 ₸", () => {
    expect(priceRange([480_000, 640_000, 1_200_000, 655_000, 3_900_000, 812_500, 705_000, 590_000])).toEqual({
      from: 590_000,
      to: 820_000,
      count: 8,
    });
  });

  it("порядок цен не важен, крайние выбросы не растягивают вилку", () => {
    const prices = [100_000, 500_000, 510_000, 520_000, 530_000, 540_000, 9_000_000];
    expect(priceRange(prices)).toEqual(priceRange([...prices].reverse()));
    expect(priceRange(prices)).toEqual({ from: 500_000, to: 540_000, count: 7 });
  });

  it("одинаковые цены дают вилку шириной в один шаг", () => {
    expect(priceRange([300_000, 300_000, 300_000])).toEqual({ from: 300_000, to: 310_000, count: 3 });
  });
});
