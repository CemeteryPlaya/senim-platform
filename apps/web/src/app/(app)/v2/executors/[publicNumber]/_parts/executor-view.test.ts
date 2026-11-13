import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { PortfolioCard, PublicExecutorPage, PublicExecutorView } from "@/modules/companies";
import { executorView, parsePublicNumber } from "./executor-view";

const t = ru.app.guest.executor;

function viewOf(over: Partial<PublicExecutorView> = {}): PublicExecutorView {
  return {
    id: "p1",
    publicNumber: 17,
    label: "Исполнитель №17",
    labelGen: "Исполнителя №17",
    labelDat: "Исполнителю №17",
    address: "Астана, Есиль",
    nameShown: false,
    segment: "COMFORT",
    ratingAvg: 4.75,
    reviewsCount: 12,
    completedDeals: 21,
    yearsExperience: 5,
    measurementTerms: "FREE",
    measurementFee: null,
    specializations: [
      { slug: "kitchen", name: "Кухни" },
      { slug: "wardrobe", name: "Шкафы" },
    ],
    ...over,
  };
}

function work(over: Partial<PortfolioCard> = {}): PortfolioCard {
  return {
    id: "w1",
    title: "Светлая кухня",
    description: "",
    furnitureType: { slug: "kitchen", name: "Кухня" },
    style: { key: "loft", name: "Лофт" },
    priceFrom: 1_200_000,
    place: "Астана",
    featured: false,
    doneOnPlatform: false,
    reviewId: null,
    photos: [],
    executor: { id: "p1", publicNumber: 17, label: "Исполнитель №17", segment: "COMFORT", ratingAvg: 4.75, reviewsCount: 12 },
    ...over,
  };
}

function page(over: Partial<PublicExecutorPage> = {}): PublicExecutorPage {
  return { view: viewOf(), about: "Делаю кухни десять лет.", portfolio: [work()], reviews: [], ...over };
}

describe("parsePublicNumber", () => {
  it.each([
    ["17", 17],
    ["1", 1],
    ["123456789", 123456789],
  ])("%s -> %s", (raw, expected) => expect(parsePublicNumber(raw)).toBe(expected));

  it.each(["", "0", "00", "-1", "1.5", "1e3", "abc", "17abc", " 17", "17 ", "1234567890", "٣", "0x10"])("%j -> null", (raw) =>
    expect(parsePublicNumber(raw)).toBeNull(),
  );
});

describe("executorView: сводка", () => {
  it("строки в порядке: рейтинг, сделки, стаж, специализации, замер, адрес", () => {
    const { rows } = executorView(page());
    expect(rows.map((r) => r.label)).toEqual([t.rows.rating, t.rows.deals, t.rows.years, t.rows.specializations, t.rows.measurement, t.rows.address]);
  });

  it("рейтинг: число как есть (шкала 1…5), число отзывов рядом", () => {
    const [rating] = executorView(page()).rows;
    expect(rating).toMatchObject({ kind: "rating", value: 4.75, count: 12 });
  });

  it("нет отзывов: рейтинг null, даже если в профиле 0", () => {
    const [rating] = executorView(page({ view: viewOf({ ratingAvg: 0, reviewsCount: 0 }) })).rows;
    expect(rating).toMatchObject({ kind: "rating", value: null, count: 0 });
  });

  it("сделки и стаж — со склонением", () => {
    const { rows } = executorView(page());
    expect(rows[1]).toMatchObject({ kind: "text", value: "21 сделка" });
    expect(rows[2]).toMatchObject({ kind: "text", value: "5 лет" });
  });

  it("стаж 0 — «не указан»", () => {
    const row = executorView(page({ view: viewOf({ yearsExperience: 0 }) })).rows[2];
    expect(row).toMatchObject({ kind: "text", value: t.yearsUnknown });
  });

  it("специализации через запятую; пусто — строки нет", () => {
    expect(executorView(page()).rows[3]).toMatchObject({ value: "Кухни, Шкафы" });
    const rows = executorView(page({ view: viewOf({ specializations: [] }) })).rows;
    expect(rows.map((r) => r.label)).not.toContain(t.rows.specializations);
  });

  it("адрес пустой — строки нет", () => {
    const rows = executorView(page({ view: viewOf({ address: "" }) })).rows;
    expect(rows.map((r) => r.label)).not.toContain(t.rows.address);
  });

  it("замер: бесплатно / входит в стоимость", () => {
    const find = (terms: "FREE" | "INCLUDED") =>
      executorView(page({ view: viewOf({ measurementTerms: terms }) })).rows.find((r) => r.label === t.rows.measurement);
    expect(find("FREE")).toMatchObject({ kind: "text", value: t.measurement.FREE });
    expect(find("INCLUDED")).toMatchObject({ kind: "text", value: t.measurement.INCLUDED });
  });

  it("замер с платой: тенге модуля -> тиыны ровно, пояснение про прямую оплату мастеру", () => {
    const row = executorView(page({ view: viewOf({ measurementTerms: "FEE_IF_NO_DEAL", measurementFee: 5000 }) })).rows.find(
      (r) => r.label === t.rows.measurement,
    );
    expect(row).toMatchObject({ kind: "fee", feeTiyn: 500_000n, value: t.measurement.feeSuffix, note: t.measurement.feeNote });
  });

  it("замер с платой без суммы: текст без суммы", () => {
    const row = executorView(page({ view: viewOf({ measurementTerms: "FEE_IF_NO_DEAL", measurementFee: null }) })).rows.find(
      (r) => r.label === t.rows.measurement,
    );
    expect(row).toMatchObject({ kind: "text", value: t.measurement.feeUnknown, note: t.measurement.feeNote });
  });
});

describe("executorView: заголовок, «О мастере»", () => {
  it("заголовок — публичная подпись, ссылка «Назад» на каталог v2", () => {
    const v = executorView(page({ view: viewOf({ label: "ТОО «Мебель Сити»", nameShown: true }) }));
    expect(v.title).toBe("ТОО «Мебель Сити»");
    expect(v.backHref).toBe("/v2/catalog");
  });

  it("абзацы по переводам строк, без пустых", () => {
    expect(executorView(page({ about: "Раз.\n\nДва.\r\n  \nТри\nЧетыре" })).about).toEqual(["Раз.", "Два.", "Три", "Четыре"]);
  });

  it("пусто — нет абзацев", () => {
    expect(executorView(page({ about: "  \n " })).about).toEqual([]);
  });

  it("текст остаётся текстом: разметка не разбирается", () => {
    expect(executorView(page({ about: "<b>x</b>" })).about).toEqual(["<b>x</b>"]);
  });
});

describe("executorView: работы и действие", () => {
  it("карточка: тип · место, цена в тиынах; только загруженные фото, иллюстрации сида — нет", () => {
    const seed = { id: "f1", src: "/demo/portfolio/a.svg", alt: "a" };
    const real = { id: "f2", src: "/files/abc", alt: "Кухня" };
    const [w] = executorView(page({ portfolio: [work({ photos: [seed, real] })] })).works;
    expect(w).toMatchObject({ id: "w1", title: "Светлая кухня", meta: "Кухня · Астана", priceFrom: 120_000_000n, photo: { src: "/files/abc", alt: "Кухня" } });
    expect(executorView(page({ portfolio: [work({ photos: [seed] })] })).works[0]).not.toHaveProperty("photo");
  });

  it("цена null — поля нет", () => {
    expect(executorView(page({ portfolio: [work({ priceFrom: null })] })).works[0]).not.toHaveProperty("priceFrom");
  });

  it("работа ведёт к заявке «похожее» на эту работу, параметр закодирован", () => {
    const [w] = executorView(page({ portfolio: [work({ id: "a b&c" })] })).works;
    expect(w?.href).toBe("/v2/requests/new?like=a+b%26c");
  });

  it("главное действие — заявка по последней работе; без работ действия нет", () => {
    expect(executorView(page({ portfolio: [work({ id: "w9" }), work({ id: "w8" })] })).action).toEqual({ href: "/v2/requests/new?like=w9", label: t.action });
    expect(executorView(page({ portfolio: [] })).action).toBeNull();
  });
});

describe("executorView: отзывы", () => {
  it("оценка, дата и текст; пустой текст остаётся пустым", () => {
    const { reviews } = executorView(
      page({
        reviews: [
          { id: "r1", rating: 5, text: "Отлично", createdAt: new Date("2026-03-05T10:00:00Z") },
          { id: "r2", rating: 4, text: "", createdAt: new Date("2026-03-31T23:30:00Z") },
        ],
      }),
    );
    expect(reviews[0]).toMatchObject({ id: "r1", ratingLabel: t.reviewRating(5), text: "Отлично" });
    expect(reviews[0]?.date).toContain("5 марта 2026");
    expect(reviews[1]?.text).toBe("");
    // 23:30 UTC — уже 1 апреля в Алматы (UTC+5).
    expect(reviews[1]?.date).toContain("1 апреля 2026");
  });
});

describe("executorView: пояснение «почему скрыто»", () => {
  it("имя скрыто: про имя и контакты, до оферты — чат", () => {
    const { explain } = executorView(page());
    expect(explain.title).toBe(t.explain.hidden.title);
    expect(explain.paragraphs).toEqual(t.explain.hidden.paragraphs);
  });

  it("имя показано: пояснение только про контакты", () => {
    const { explain } = executorView(page({ view: viewOf({ nameShown: true }) }));
    expect(explain.title).toBe(t.explain.shown.title);
  });
});
