import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { HighlightCard, PortfolioCard, PublicExecutorView } from "@/modules/companies";
import type { DealHistoryItem, ExecutorStats } from "@/modules/deal-core";
import { executorView, parsePublicNumber, type ExecutorPageData } from "./executor-view";

const t = ru.app.guest.executor;

function viewOf(over: Partial<PublicExecutorView> = {}): PublicExecutorView {
  return {
    id: "p1",
    publicNumber: 17,
    label: "Исполнитель №17",
    labelGen: "Исполнителя №17",
    labelDat: "Исполнителю №17",
    address: "Астана",
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

function deal(over: Partial<DealHistoryItem> = {}): DealHistoryItem {
  return {
    id: "d1",
    title: "Кухня в ЖК",
    segment: "COMFORT",
    endedAt: new Date("2026-10-15T10:00:00Z"),
    outcome: "success",
    photos: [],
    priceTiyn: null,
    place: null,
    review: null,
    ...over,
  };
}

const STATS: ExecutorStats = { deals: 15, ended: 14, successful: 13, successRate: 93 };

function page(over: Partial<ExecutorPageData> = {}): ExecutorPageData {
  return { view: viewOf(), about: "Делаю кухни десять лет.", highlights: [], offPlatform: [work()], stats: STATS, dealHistory: [], ...over };
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

describe("executorView: шапка с числами", () => {
  it("рейтинг (число отзывов подписью), сделок, «Успешных 93%»", () => {
    expect(executorView(page()).stats).toEqual([
      { value: "4,8", label: "12 отзывов" },
      { value: "15", label: t.stats.deals },
      { value: "93%", label: t.stats.success },
    ]);
  });

  it("нет отзывов, сделок и оконченных: прочерк и подпись, чего нет; ноль сделок — приглушён", () => {
    const stats = executorView(
      page({ view: viewOf({ ratingAvg: 0, reviewsCount: 0 }), stats: { deals: 0, ended: 0, successful: 0, successRate: null } }),
    ).stats;
    expect(stats).toEqual([
      { value: t.emptyValue, label: ru.app.kit.rating.none, muted: true },
      { value: "0", label: t.stats.deals, muted: true },
      { value: t.emptyValue, label: t.stats.successNone, muted: true },
    ]);
    expect(t.stats.successNone.toLowerCase()).toBe("пока нет завершённых сделок");
  });

  it("сделки идут, но оконченных нет — процента нет", () => {
    const stats = executorView(page({ stats: { deals: 2, ended: 0, successful: 0, successRate: null } })).stats;
    expect(stats[1]).toEqual({ value: "2", label: t.stats.deals });
    expect(stats[2]).toEqual({ value: t.emptyValue, label: t.stats.successNone, muted: true });
  });

  it("ноль успешных из оконченных — «0%», не прочерк", () => {
    expect(executorView(page({ stats: { deals: 1, ended: 1, successful: 0, successRate: 0 } })).stats[2]).toEqual({ value: "0%", label: t.stats.success });
  });
});

describe("executorView: условия", () => {
  const find = (v: PublicExecutorView, label: string) => executorView(page({ view: v })).conditions.find((r) => r.label === label);

  it("строки: специализация, замер, где работает, стаж; вид задан явно", () => {
    const rows = executorView(page()).conditions;
    expect(rows.map((r) => r.label)).toEqual([t.rows.specializations, t.rows.measurement, t.rows.address, t.rows.experience]);
    expect(rows[0]).toMatchObject({ value: "Кухни, Шкафы", layout: "stacked" });
    expect(rows[1]).toMatchObject({ value: t.measurement.FREE, layout: "inline" });
    expect(rows[2]).toMatchObject({ value: "Астана", layout: "stacked" });
    expect(rows[3]).toMatchObject({ value: "5 лет", layout: "inline" });
  });

  it("нет специализаций, адреса и стажа — строк нет", () => {
    const labels = executorView(page({ view: viewOf({ specializations: [], address: " ", yearsExperience: 0 }) })).conditions.map((r) => r.label);
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
  it("«Назад» ведёт в список мастеров; с заказом в адресе — с тем же ?request=", () => {
    expect(executorView(page()).backHref).toBe("/v2/executors");
    expect(executorView(page(), { requestId: "r1" }).backHref).toBe("/v2/executors?request=r1");
  });

  it("заголовок — публичная подпись (ADR-006)", () => {
    const v = executorView(page({ view: viewOf({ label: "ТОО «Мебель Сити»", nameShown: true }) }));
    expect(v.title).toBe("ТОО «Мебель Сити»");
    expect(v.backHref).toBe("/v2/executors");
    expect(executorView(page()).title).toBe("Исполнитель №17");
  });

  it("монограмма — только у открытого имени: у «Исполнитель №N» кружок «№N» повторял бы заголовок", () => {
    expect(executorView(page()).monogram).toBe(false);
    expect(executorView(page({ view: viewOf({ label: "ТОО «Мебель Сити»", nameShown: true }) })).monogram).toBe(true);
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

describe("executorView: лучшие работы", () => {
  const card = (over: Partial<HighlightCard> = {}): HighlightCard => ({ kind: "work", id: "h1", title: "Шкаф-купе", photo: null, href: null, ...over });

  it("в порядке мастера; сделка и работа вне площадки подписаны по-разному; фото — как есть", () => {
    const photo = { src: "/files/x", alt: "Кухня, фото 1" };
    const v = executorView(page({ highlights: [card({ kind: "deal", id: "d9", title: "Кухня", photo }), card()] }));
    expect(v.highlights).toEqual([
      { id: "d9", title: "Кухня", meta: t.highlightKind.deal, photo },
      { id: "h1", title: "Шкаф-купе", meta: t.highlightKind.work },
    ]);
  });

  it("иллюстрация сида — не фото мастера; нет витрины — пусто (раздел скрыт)", () => {
    expect(executorView(page({ highlights: [card({ photo: { src: "/demo/portfolio/a.svg", alt: "a" } })] })).highlights[0]).not.toHaveProperty("photo");
    expect(executorView(page()).highlights).toEqual([]);
  });
});

describe("executorView: сделки на площадке", () => {
  it("по одной карточке на сделку, в порядке модуля: что делали, уровень, месяц, итог", () => {
    const v = executorView(
      page({
        dealHistory: [
          deal({ id: "a", outcome: "success" }),
          // 23:30 UTC 31 октября — уже ноябрь в Алматы (UTC+5).
          deal({ id: "b", title: "Шкаф", segment: null, outcome: "failed", endedAt: new Date("2026-10-31T23:30:00Z") }),
        ],
      }),
    );
    expect(v.deals.map((d) => d.id)).toEqual(["a", "b"]);
    expect(v.deals[0]).toMatchObject({ title: "Кухня в ЖК", meta: `${t.segments.COMFORT} · октябрь 2026`, outcome: { label: t.outcome.success, tone: "accent" } });
    expect(v.deals[1]).toMatchObject({ title: "Шкаф", meta: "ноябрь 2026", outcome: { label: t.outcome.failed, tone: "neutral" } });
    expect(t.outcome.success.toLowerCase()).toBe("завершена");
    expect(t.outcome.failed.toLowerCase()).toBe("не состоялась");
  });

  it("закрытый вид (без выбора покупателя): нет фото, стоимости, места и отзыва — только сведения о сделке", () => {
    const [d] = executorView(page({ dealHistory: [deal()] })).deals;
    expect(d?.photos).toEqual([]);
    expect(d).not.toHaveProperty("priceTiyn");
    expect(d).not.toHaveProperty("place");
    expect(d).not.toHaveProperty("review");
  });

  it("по выбору покупателя: фото (подпись — что делали), стоимость в тиынах, место — ровно как отдал модуль", () => {
    const photos = [{ id: "f1", src: "/files/a?sig=1", alt: "Кухня в ЖК, фото 1" }];
    const [d] = executorView(page({ dealHistory: [deal({ photos, priceTiyn: 45_000_000n, place: "Астана" })] })).deals;
    expect(d?.photos).toEqual([{ src: "/files/a?sig=1", alt: "Кухня в ЖК, фото 1", caption: "Кухня в ЖК" }]);
    expect(d?.priceTiyn).toBe(45_000_000n);
    expect(d?.place).toBe("Астана");
  });

  it("отзыв — внизу своей сделки: оценка, текст, подпись как выбрал покупатель", () => {
    const createdAt = new Date("2026-10-20T10:00:00Z");
    const v = executorView(
      page({
        dealHistory: [
          deal({ id: "a", review: { rating: 5, text: "  Отличная кухня \n", signedAs: "Айгерим", createdAt } }),
          deal({ id: "b", review: { rating: 3, text: "", signedAs: "А.", createdAt } }),
          deal({ id: "c" }),
        ],
      }),
    );
    expect(v.deals[0]?.review).toEqual({ ratingLabel: t.reviewRating(5), text: "Отличная кухня", signature: t.reviewSignature("Айгерим") });
    expect(v.deals[1]?.review).toEqual({ ratingLabel: t.reviewRating(3), text: "", signature: t.reviewSignature("А.") });
    expect(v.deals[2]).not.toHaveProperty("review");
    expect(t.reviewSignature("А.")).toContain("А.");
  });

  it("пустая подпись — без подписи", () => {
    const [d] = executorView(page({ dealHistory: [deal({ review: { rating: 4, text: "Хорошо", signedAs: "", createdAt: new Date() } })] })).deals;
    expect(d?.review).toEqual({ ratingLabel: t.reviewRating(4), text: "Хорошо" });
  });

  it("сделок нет — пустой список (раздел с текстом-заглушкой)", () => {
    expect(executorView(page()).deals).toEqual([]);
  });
});

describe("executorView: работы вне площадки и действие", () => {
  const seed = { id: "f1", src: "/demo/portfolio/a.svg", alt: "a" };
  const real = { id: "f2", src: "/files/abc", alt: "Кухня" };

  it("карточка: место, цена в тиынах; пометки «вне площадки» и типа нет (их держат заголовки); только загруженные фото", () => {
    const [w] = executorView(page({ offPlatform: [work({ photos: [seed, real] })] })).offPlatform.works;
    expect(w).toMatchObject({
      id: "w1",
      title: "Светлая кухня",
      meta: "Астана",
      priceFrom: 120_000_000n,
      photo: { src: "/files/abc", alt: "Кухня" },
    });
    expect(w).not.toHaveProperty("byline");
    expect(executorView(page({ offPlatform: [work({ photos: [seed] })] })).offPlatform.works[0]).not.toHaveProperty("photo");
  });

  it("карточки неинтерактивны: адреса нет; цена null — поля нет", () => {
    expect(executorView(page()).offPlatform.works[0]).not.toHaveProperty("href");
    expect(executorView(page({ offPlatform: [work({ priceFrom: null })] })).offPlatform.works[0]).not.toHaveProperty("priceFrom");
  });

  it("галерея: обложки работ первыми, потом остальные снимки; иллюстрации сида не попадают", () => {
    const more = { id: "f3", src: "/files/def", alt: "Вид сбоку" };
    const other = { id: "f4", src: "/files/ghi", alt: "Шкаф" };
    const { gallery } = executorView(page({ offPlatform: [work({ id: "a", photos: [seed, real, more] }), work({ id: "b", title: "Шкаф", photos: [other] })] })).offPlatform;
    expect(gallery.map((p) => p.src)).toEqual(["/files/abc", "/files/ghi", "/files/def"]);
    expect(gallery[0]).toEqual({ src: "/files/abc", alt: "Кухня", caption: "Светлая кухня" });
    expect(executorView(page({ offPlatform: [] })).offPlatform).toEqual({ works: [], gallery: [] });
  });

  it("главное действие — у любого мастера: заявка с публичным номером мастера", () => {
    const expected = { href: "/v2/requests/new?executor=17", label: t.action };
    expect(executorView(page()).action).toEqual(expected);
    expect(executorView(page({ offPlatform: [], dealHistory: [] })).action).toEqual(expected);
  });

  it("отдельного раздела отзывов в модели нет", () => {
    expect(executorView(page())).not.toHaveProperty("reviews");
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
