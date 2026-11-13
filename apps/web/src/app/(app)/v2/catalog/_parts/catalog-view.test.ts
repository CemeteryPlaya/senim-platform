import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { CatalogFilter, PortfolioCard } from "@/modules/companies";
import { catalogView, type CatalogResult } from "./catalog-view";

const t = ru.app.guest.catalog;

const facets = {
  types: [
    { slug: "kitchen", name: "Кухня" },
    { slug: "wardrobe", name: "Шкаф" },
  ],
};

function card(over: Partial<PortfolioCard> = {}): PortfolioCard {
  return {
    id: "w1",
    title: "Светлая кухня",
    description: "Фасады МДФ",
    furnitureType: { slug: "kitchen", name: "Кухня" },
    style: { key: "loft", name: "Лофт" },
    priceFrom: 1_200_000,
    place: "Астана",
    featured: false,
    doneOnPlatform: false,
    reviewId: null,
    photos: [],
    executor: { id: "e1", publicNumber: 7, label: "Исполнитель №7", segment: "COMFORT", ratingAvg: 4.5, reviewsCount: 3 },
    ...over,
  };
}

const result = (over: Partial<CatalogResult> = {}): CatalogResult => ({ items: [card()], total: 1, page: 1, pageCount: 1, ...over });
const view = (r: CatalogResult, filter: CatalogFilter = { page: 1 }) => catalogView(r, facets, filter);

describe("catalogView: чипы", () => {
  it("тип: «Все» первой, активна без фильтра, остальные ведут на v2", () => {
    const { typeChips } = view(result());
    expect(typeChips.map((c) => c.label)).toEqual([t.allTypes, "Кухня", "Шкаф"]);
    expect(typeChips.map((c) => c.active)).toEqual([true, false, false]);
    expect(typeChips.map((c) => c.href)).toEqual(["/v2/catalog", "/v2/catalog?type=kitchen", "/v2/catalog?type=wardrobe"]);
  });

  it("тип, которого нет в фасетах, не выбирает ни один чип: активна «Все типы»", () => {
    const { typeChips } = view(result(), { page: 1, type: "unknown-type" });
    expect(typeChips.map((c) => c.active)).toEqual([true, false, false]);
  });

  it("активный тип помечен, «Все» сбрасывает только тип", () => {
    const { typeChips } = view(result(), { page: 1, type: "wardrobe", price: "300-700" });
    expect(typeChips.map((c) => c.active)).toEqual([false, false, true]);
    expect(typeChips[0].href).toBe("/v2/catalog?price=300-700");
  });

  it("цена: «Любая» и четыре корзины с подписями из ru", () => {
    const { priceChips } = view(result());
    expect(priceChips.map((c) => c.label)).toEqual([t.allPrices, t.prices.upto300, t.prices["300-700"], t.prices["700-1500"], t.prices.from1500]);
    expect(priceChips.map((c) => c.active)).toEqual([true, false, false, false, false]);
    expect(priceChips[2].href).toBe("/v2/catalog?price=300-700");
  });

  it("ссылки чипов сохраняют остальные фильтры и сбрасывают страницу", () => {
    const filter: CatalogFilter = { page: 3, type: "kitchen", style: "loft", segment: "PREMIUM", price: "upto300" };
    const { typeChips, priceChips } = view(result({ page: 3, pageCount: 5 }), filter);
    expect(typeChips[2].href).toBe("/v2/catalog?type=wardrobe&style=loft&segment=PREMIUM&price=upto300");
    expect(priceChips[0].href).toBe("/v2/catalog?type=kitchen&style=loft&segment=PREMIUM");
    expect(priceChips[3].href).toBe("/v2/catalog?type=kitchen&style=loft&segment=PREMIUM&price=700-1500");
    expect([...typeChips, ...priceChips].some((c) => c.href.includes("page="))).toBe(false);
    expect(priceChips[1].active).toBe(true);
  });
});

describe("catalogView: карточки", () => {
  it("12 карточек остаются 12", () => {
    const items = Array.from({ length: 12 }, (_, i) => card({ id: `w${i}`, executor: { ...card().executor, publicNumber: 100 + i } }));
    const v = view(result({ items, total: 30, pageCount: 3 }));
    expect(v.state).toBe("results");
    expect(v.cards).toHaveLength(12);
    expect(v.cards[11].href).toBe("/v2/executors/111");
  });

  it("карточка: ссылка на профиль, тип · место, цена в тиынах", () => {
    const [c] = view(result()).cards;
    expect(c).toEqual({ id: "w1", href: "/v2/executors/7", title: "Светлая кухня", meta: "Кухня · Астана", byline: "Исполнитель №7 · 4,5 · 3 отзыва", priceFrom: 120_000_000n });
  });

  it("место не указано — в meta только тип; цены нет — поля priceFrom нет", () => {
    const [c] = view(result({ items: [card({ place: "", priceFrom: null })] })).cards;
    expect(c.meta).toBe("Кухня");
    expect(c).not.toHaveProperty("priceFrom");
  });

  it("строка мастера: метка модуля, рейтинг и отзывы с правильным склонением", () => {
    const by = (reviewsCount: number, ratingAvg = 4.8) =>
      view(result({ items: [card({ executor: { ...card().executor, label: "Исполнитель №1042", reviewsCount, ratingAvg } })] })).cards[0].byline;
    expect(by(0, 0)).toBe("Исполнитель №1042");
    expect(by(0)).toBe("Исполнитель №1042");
    expect(by(1)).toBe("Исполнитель №1042 · 4,8 · 1 отзыв");
    expect(by(2)).toBe("Исполнитель №1042 · 4,8 · 2 отзыва");
    expect(by(12)).toBe("Исполнитель №1042 · 4,8 · 12 отзывов");
    expect(by(21)).toBe("Исполнитель №1042 · 4,8 · 21 отзыв");
    expect(by(3, 0)).toBe("Исполнитель №1042 · 3 отзыва");
  });

  it("в карточке только публичные поля: нет id мастера, сегмента, описания", () => {
    const [c] = view(result()).cards;
    expect(Object.keys(c).sort()).toEqual(["byline", "href", "id", "meta", "priceFrom", "title"]);
    expect(JSON.stringify(c, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("e1");
  });

  it("цена ноль — цена не показывается", () => {
    expect(view(result({ items: [card({ priceFrom: 0 })] })).cards[0]).not.toHaveProperty("priceFrom");
  });

  it("вид карточек страницы: хотя бы одно настоящее фото — slot у всех, иначе none", () => {
    const real = { id: "p1", src: "https://files.example/p1.jpg?sig=1", alt: "Фото 1" };
    const seed = { id: "p2", src: "/demo/portfolio/kitchen-sage.svg", alt: "Фото 2" };
    const two = (a: PortfolioCard["photos"], b: PortfolioCard["photos"]) => view(result({ items: [card({ id: "a", photos: a }), card({ id: "b", photos: b })], total: 2 }));
    expect(two([], []).media).toBe("none");
    expect(two([seed], [seed]).media).toBe("none");
    const mixed = two([real], []);
    expect(mixed.media).toBe("slot");
    expect(mixed.cards[1]).not.toHaveProperty("photo");
  });

  it("фото: загруженный снимок идёт в карточку, статичная иллюстрация сида — нет", () => {
    const real = { id: "p1", src: "https://files.example/p1.jpg?sig=1", alt: "Фото 1" };
    const seed = { id: "p2", src: "/demo/portfolio/kitchen-sage.svg", alt: "Фото 2" };
    expect(view(result({ items: [card({ photos: [real] })] })).cards[0].photo).toEqual({ src: real.src, alt: real.alt });
    expect(view(result({ items: [card({ photos: [seed] })] })).cards[0]).not.toHaveProperty("photo");
    expect(view(result({ items: [card({ photos: [seed, real] })] })).cards[0].photo?.src).toBe(real.src);
  });
});

describe("catalogView: счёт, страницы и состояния", () => {
  it("строка «Найдено N работ» и пагинация по адресам v2 с сохранением фильтра", () => {
    const v = view(result({ total: 30, page: 2, pageCount: 3 }), { page: 2, type: "kitchen" });
    expect(v.found).toBe(t.found(30));
    expect(v.page).toBe(2);
    expect(v.pageCount).toBe(3);
    expect(v.hrefFor(1)).toBe("/v2/catalog?type=kitchen");
    expect(v.hrefFor(3)).toBe("/v2/catalog?type=kitchen&page=3");
    expect(v.empty).toBeNull();
    expect(v.similarLink).toEqual({ href: "/v2/requests/new", label: t.similarLink });
  });

  it("пустой результат по фильтру: «Сбросить фильтр» на каталог", () => {
    const v = view(result({ items: [], total: 0 }), { page: 1, price: "from1500" });
    expect(v.state).toBe("empty-filter");
    expect(v.found).toBeNull();
    expect(v.cards).toEqual([]);
    expect(v.empty).toEqual({ title: t.emptyFilter.title, body: t.emptyFilter.body, action: { href: "/v2/catalog", label: t.emptyFilter.action } });
  });

  it("пустой каталог без фильтра: объяснение и действие на главную, фильтров нет", () => {
    const v = view(result({ items: [], total: 0 }));
    expect(v.state).toBe("empty-catalogue");
    expect(v.showFilters).toBe(false);
    expect(v.empty).toEqual({ title: t.emptyCatalogue.title, body: t.emptyCatalogue.body, action: { href: "/v2", label: t.emptyCatalogue.action } });
  });

  it("страница за последней: пустой экран со ссылкой на первую страницу с тем же фильтром", () => {
    const v = view(result({ items: [], total: 30, page: 9, pageCount: 3 }), { page: 9, type: "kitchen" });
    expect(v.state).toBe("beyond");
    expect(v.showFilters).toBe(true);
    expect(v.empty).toEqual({ title: "Такой страницы нет", body: "В каталоге 3 страницы", action: { href: "/v2/catalog?type=kitchen", label: t.beyond.action } });
    expect(v.similarLink).toBeNull();
    expect(v.cards).toEqual([]);
  });

  it("с результатами пустого состояния (и главного действия) нет", () => {
    const v = view(result());
    expect(v.state).toBe("results");
    expect(v.empty).toBeNull();
    expect(v.showFilters).toBe(true);
  });
});

describe("ru.app.guest.catalog: склонения страниц", () => {
  it.each([
    [1, "В каталоге 1 страница"],
    [2, "В каталоге 2 страницы"],
    [5, "В каталоге 5 страниц"],
    [11, "В каталоге 11 страниц"],
    [21, "В каталоге 21 страница"],
  ])("%i", (n, expected) => {
    expect(t.pagesInCatalogue(n)).toBe(expected);
  });
});

describe("ru.app.guest.catalog.found: множественное число", () => {
  it.each([
    [0, "Найдено 0 работ"],
    [1, "Найдена 1 работа"],
    [2, "Найдено 2 работы"],
    [4, "Найдено 4 работы"],
    [5, "Найдено 5 работ"],
    [11, "Найдено 11 работ"],
    [12, "Найдено 12 работ"],
    [21, "Найдена 21 работа"],
    [22, "Найдено 22 работы"],
    [111, "Найдено 111 работ"],
  ])("%i", (n, expected) => {
    expect(t.found(n)).toBe(expected);
  });
});
