import { describe, expect, it } from "vitest";
import { catalogHref, parseCatalogFilter, priceRange } from "./catalog-filter";

describe("parseCatalogFilter", () => {
  it("разбирает корректные параметры", () => {
    expect(parseCatalogFilter({ type: "kitchen", style: "loft", segment: "PREMIUM", price: "700-1500", page: "3" })).toEqual({
      type: "kitchen",
      style: "loft",
      segment: "PREMIUM",
      price: "700-1500",
      page: 3,
    });
  });

  it("пустые и неизвестные значения игнорирует, страница по умолчанию — 1", () => {
    expect(parseCatalogFilter({ type: "", style: "gothic", segment: "VIP", price: "cheap", page: "-2" })).toEqual({ page: 1 });
    expect(parseCatalogFilter({ page: "abc" })).toEqual({ page: 1 });
    expect(parseCatalogFilter({})).toEqual({ page: 1 });
  });

  it("из повторяющегося параметра берёт первое значение", () => {
    expect(parseCatalogFilter({ style: ["scandi", "loft"] })).toEqual({ style: "scandi", page: 1 });
  });

  it("не принимает в type ничего, кроме slug", () => {
    expect(parseCatalogFilter({ type: "kitchen'; drop table" })).toEqual({ page: 1 });
  });
});

describe("priceRange", () => {
  it.each([
    ["upto300", { lte: 300_000 }],
    ["300-700", { gte: 300_000, lte: 700_000 }],
    ["700-1500", { gte: 700_000, lte: 1_500_000 }],
    ["from1500", { gte: 1_500_000 }],
  ] as const)("%s → %o", (bucket, range) => {
    expect(priceRange(bucket)).toEqual(range);
  });
});

describe("catalogHref", () => {
  it("собирает адрес без пустых параметров и сбрасывает страницу при смене фильтра", () => {
    expect(catalogHref({ type: "kitchen", page: 1 })).toBe("/catalog?type=kitchen");
    expect(catalogHref({ type: "kitchen", style: "loft", page: 2 })).toBe("/catalog?type=kitchen&style=loft&page=2");
    expect(catalogHref({ page: 1 })).toBe("/catalog");
  });
});
