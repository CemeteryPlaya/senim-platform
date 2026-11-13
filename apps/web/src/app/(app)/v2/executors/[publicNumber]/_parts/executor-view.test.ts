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

describe("executorView: строка-сводка", () => {
  it("рейтинг: число как есть (шкала 1…5), число отзывов рядом", () => {
    expect(executorView(page()).rating).toEqual({ value: 4.75, count: 12 });
  });

  it("нет отзывов: рейтинг null, даже если в профиле 0", () => {
    expect(executorView(page({ view: viewOf({ ratingAvg: 0, reviewsCount: 0 }) })).rating).toEqual({ value: null, count: 0 });
  });

  it("сделки на платформе и стаж — со склонением: значение отдельно от пояснений", () => {
    expect(executorView(page()).facts).toEqual([
      { value: "21 сделка", after: "на платформе" },
      { before: "Стаж", value: "5 лет" },
    ]);
  });

  it("стаж 0 — факта нет; сделок 0 — «0 сделок»", () => {
    expect(executorView(page({ view: viewOf({ yearsExperience: 0, completedDeals: 0 }) })).facts).toEqual([{ value: "0 сделок", after: "на платформе" }]);
  });
});

describe("executorView: условия", () => {
  const find = (v: PublicExecutorView, label: string) => executorView(page({ view: v })).conditions.find((r) => r.label === label);

  it("строки: специализация, замер, где работает; вид задан явно", () => {
    const rows = executorView(page()).conditions;
    expect(rows.map((r) => r.label)).toEqual([t.rows.specializations, t.rows.measurement, t.rows.address]);
    expect(rows[0]).toMatchObject({ value: "Кухни, Шкафы", layout: "stacked" });
    expect(rows[1]).toMatchObject({ value: t.measurement.FREE, layout: "inline" });
    expect(rows[2]).toMatchObject({ value: "Астана, Есиль", layout: "stacked" });
  });

  it("нет специализаций или адреса — строки нет", () => {
    const labels = executorView(page({ view: viewOf({ specializations: [], address: " " }) })).conditions.map((r) => r.label);
    expect(labels).toEqual([t.rows.measurement]);
  });

  it("замер: входит в стоимость", () => {
    expect(find(viewOf({ measurementTerms: "INCLUDED" }), t.rows.measurement)).toMatchObject({ value: t.measurement.INCLUDED, layout: "stacked" });
  });

  it("замер с платой: тенге модуля -> тиыны ровно, пояснение про прямую оплату мастеру", () => {
    expect(find(viewOf({ measurementTerms: "FEE_IF_NO_DEAL", measurementFee: 5000 }), t.rows.measurement)).toEqual({
      label: t.rows.measurement,
      feeTiyn: 500_000n,
      value: t.measurement.feeSuffix,
      note: t.measurement.feeNote,
      layout: "stacked",
    });
  });

  it("замер с платой без суммы: текст без суммы", () => {
    const row = find(viewOf({ measurementTerms: "FEE_IF_NO_DEAL", measurementFee: null }), t.rows.measurement);
    expect(row).toMatchObject({ value: t.measurement.feeUnknown, note: t.measurement.feeNote });
    expect(row).not.toHaveProperty("feeTiyn");
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
  const seed = { id: "f1", src: "/demo/portfolio/a.svg", alt: "a" };
  const real = { id: "f2", src: "/files/abc", alt: "Кухня" };

  it("карточка: тип · место, цена в тиынах; только загруженные фото, иллюстрации сида — нет", () => {
    const [w] = executorView(page({ portfolio: [work({ photos: [seed, real] })] })).works;
    expect(w).toMatchObject({ id: "w1", title: "Светлая кухня", meta: "Кухня · Астана", priceFrom: 120_000_000n, photo: { src: "/files/abc", alt: "Кухня" } });
    expect(executorView(page({ portfolio: [work({ photos: [seed] })] })).works[0]).not.toHaveProperty("photo");
  });

  it("карточки неинтерактивны: адреса нет", () => {
    expect(executorView(page()).works[0]).not.toHaveProperty("href");
  });

  it("цена null — поля нет", () => {
    expect(executorView(page({ portfolio: [work({ priceFrom: null })] })).works[0]).not.toHaveProperty("priceFrom");
  });

  it("область изображения: хоть одно настоящее фото — slot у всех, иначе none", () => {
    expect(executorView(page({ portfolio: [work({ id: "a", photos: [real] }), work({ id: "b" })] })).worksMedia).toBe("slot");
    expect(executorView(page({ portfolio: [work({ photos: [seed] })] })).worksMedia).toBe("none");
    expect(executorView(page({ portfolio: [] })).worksMedia).toBe("none");
  });

  it("главное действие — у любого мастера: заявка с публичным номером мастера", () => {
    const expected = { href: "/v2/requests/new?executor=17", label: t.action };
    expect(executorView(page()).action).toEqual(expected);
    expect(executorView(page({ portfolio: [] })).action).toEqual(expected);
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
