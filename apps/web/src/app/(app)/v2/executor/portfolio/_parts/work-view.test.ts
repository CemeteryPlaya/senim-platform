import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { OwnPortfolioItem } from "@/modules/companies";
import { createWorkSchema, PHOTOS_MAX, updateWorkSchema } from "./work-schema";
import { EMPTY_VALUES, STYLE_OPTIONS, initialValues, toPrice, workListView, workRow } from "./work-view";

const t = ru.app.masterPortfolio;

const item = (over: Partial<OwnPortfolioItem> = {}): OwnPortfolioItem => ({
  id: "w1",
  title: "Кухня с островом",
  description: "МДФ эмаль",
  furnitureType: { id: "ft1", name: "Кухня" },
  style: { key: "loft", name: "Лофт" },
  priceFrom: 850_000,
  published: true,
  place: "Астана",
  fromDeal: null,
  photos: [{ id: "f1", src: "https://files.example/1.jpg", alt: "Фото 1" }],
  createdAt: new Date("2026-11-01T10:00:00Z"),
  ...over,
});

describe("список работ", () => {
  it("строка: адрес правки, тип и стиль, статус и число фото, цена «от» в тиынах, обложка", () => {
    const row = workRow(item());
    expect(row).toMatchObject({ id: "w1", href: "/v2/executor/portfolio/w1", status: t.list.published, details: `Кухня · Лофт · ${t.list.photos(1)}`, published: true, priceFrom: 85_000_000n });
    expect(row.photo).toEqual({ src: "https://files.example/1.jpg", alt: "Фото 1" });
  });

  it("скрытая без фото и без цены; иллюстрации сида не считаются фото; ноль — цены нет", () => {
    const row = workRow(item({ published: false, priceFrom: 0, photos: [{ id: "f", src: "/demo/portfolio/x.svg", alt: "" }] }));
    expect(row.status).toBe(t.list.hidden);
    expect(row.priceFrom).toBeUndefined();
    expect(row.photo).toBeUndefined();
    expect(workRow(item({ priceFrom: null, photos: [] })).details).toBe(`Кухня · Лофт · ${t.list.photos(0)}`);
  });

  it("область изображения: есть хоть одно настоящее фото — у всех slot, иначе none; счёт работ со склонением", () => {
    expect(workListView([item(), item({ id: "w2", photos: [] })]).media).toBe("slot");
    expect(workListView([item({ photos: [] })]).media).toBe("none");
    expect([1, 2, 5, 11, 21].map((n) => t.list.count(n))).toEqual(["1 работа", "2 работы", "5 работ", "11 работ", "21 работа"]);
  });
});

describe("форма работы", () => {
  it("начальные значения: правка берёт работу, новая — пустую и опубликованную", () => {
    expect(initialValues(item())).toEqual({ furnitureTypeId: "ft1", style: "loft", title: "Кухня с островом", description: "МДФ эмаль", place: "Астана", price: "850000", published: true });
    expect(initialValues(item({ priceFrom: null, style: { key: "unknown", name: "unknown" } }))).toMatchObject({ price: "", style: "" });
    expect(EMPTY_VALUES).toMatchObject({ style: "", published: true, price: "" });
  });

  it("цена: пробелы допустимы, пусто — null, мусор — NaN", () => {
    expect(toPrice("1 200 000")).toBe(1_200_000);
    expect(toPrice("1 200")).toBe(1200);
    expect(toPrice("  ")).toBeNull();
    expect(toPrice("abc")).toBeNaN();
  });

  it("стили — весь справочник, у каждого название и подсказка", () => {
    expect(STYLE_OPTIONS.length).toBeGreaterThanOrEqual(6);
    expect(STYLE_OPTIONS.every((o) => o.label && o.description)).toBe(true);
  });
});

describe("схема работы", () => {
  const valid = { furnitureTypeId: "ft1", style: "loft", title: "Кухня", description: "", priceFrom: null, published: true, place: "", fileIds: [] };

  it("верное проходит; лишние поля — нет", () => {
    expect(createWorkSchema.safeParse(valid).success).toBe(true);
    expect(createWorkSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(updateWorkSchema.safeParse({ ...valid, id: "w1" }).success).toBe(true);
    expect(updateWorkSchema.safeParse(valid).success).toBe(false);
  });

  it.each([
    ["тип", { furnitureTypeId: "" }, "furnitureTypeId"],
    ["стиль", { style: "" }, "style"],
    ["название короче 3", { title: "ab" }, "title"],
    ["цена не число", { priceFrom: Number.NaN }, "priceFrom"],
    ["цена дробная", { priceFrom: 10.5 }, "priceFrom"],
    ["цена отрицательная", { priceFrom: -1 }, "priceFrom"],
    [`фото больше ${PHOTOS_MAX}`, { fileIds: Array.from({ length: PHOTOS_MAX + 1 }, (_, i) => `f${i}`) }, "fileIds"],
  ])("ошибка у поля: %s", (_name, over, field) => {
    const parsed = createWorkSchema.safeParse({ ...valid, ...over });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path[0])).toContain(field);
  });
});

describe("тексты портфолио мастера: слова", () => {
  it("нет слов «заказчик», «клиент», «платформа», «отклик», «комисси», «эскроу», «демо», «тестов»", () => {
    const all = JSON.stringify(t);
    expect(all).not.toMatch(/заказчик|клиент|платформ|отклик|комисси|эскроу|демо|тестов/i);
  });
});
