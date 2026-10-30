import { describe, expect, it } from "vitest";
import { applyStep, parseDetails, requestDetailsSchema, segmentInputOf, stepInputSchema } from "./schema";

describe("схема details", () => {
  it("принимает формат сида, включая групповое «не знаю» по материалам", () => {
    const seed = [
      { widthCm: 220, heightCm: 270, depthCm: 150, unknown: ["materials"] },
      { widthCm: 340, heightCm: 270, depthCm: 60, facade: "mdf_enamel", countertop: "compact", hardware: "soft_close", color: "Шалфей" },
      { facade: "mdf_film", hardware: "soft_close", color: "Белый и голубой", unknown: ["size"] },
      {},
    ];
    for (const d of seed) expect(requestDetailsSchema.safeParse(d).success).toBe(true);
  });

  it("«materials» из сида раскрывается в фасады, столешницу и фурнитуру", () => {
    expect(parseDetails({ unknown: ["materials", "size"] }).unknown).toEqual(["facade", "countertop", "hardware", "size"]);
  });

  it("не принимает материал не из справочника и лишние поля", () => {
    expect(requestDetailsSchema.safeParse({ facade: "gold" }).success).toBe(false);
    expect(requestDetailsSchema.safeParse({ price: 1 }).success).toBe(false);
  });

  it("не принимает поле, которое одновременно заполнено и помечено «не знаю»", () => {
    expect(requestDetailsSchema.safeParse({ widthCm: 200, unknown: ["size"] }).success).toBe(false);
    expect(requestDetailsSchema.safeParse({ facade: "ldsp", unknown: ["facade"] }).success).toBe(false);
  });

  it("не принимает нереальные размеры", () => {
    expect(requestDetailsSchema.safeParse({ widthCm: 0 }).success).toBe(false);
    expect(requestDetailsSchema.safeParse({ widthCm: 99999 }).success).toBe(false);
    expect(requestDetailsSchema.safeParse({ widthCm: 12.5 }).success).toBe(false);
  });

  it("даёт вход для подсказки сегмента без полей «не знаю»", () => {
    expect(segmentInputOf(parseDetails({ widthCm: 500, facade: "ldsp", unknown: ["countertop"] }))).toEqual({
      widthCm: 500,
      facade: "ldsp",
      countertop: undefined,
      hardware: undefined,
    });
  });
});

describe("шаги мастера", () => {
  it("тип: либо из справочника, либо свой текст", () => {
    expect(stepInputSchema.safeParse({ screen: "type", furnitureTypeId: "t1", customType: null }).success).toBe(true);
    expect(stepInputSchema.safeParse({ screen: "type", furnitureTypeId: null, customType: "Кровать-чердак" }).success).toBe(true);
    expect(stepInputSchema.safeParse({ screen: "type", furnitureTypeId: null, customType: "  " }).success).toBe(false);
    expect(stepInputSchema.safeParse({ screen: "type", furnitureTypeId: "t1", customType: "Кровать" }).success).toBe(false);
  });

  it("размеры «не знаю» стирают введённые размеры и ставят пометку", () => {
    const step = stepInputSchema.parse({ screen: "size", size: { mode: "unknown" } });
    expect(applyStep(parseDetails({ widthCm: 300, heightCm: 250, facade: "ldsp" }), step)).toEqual({
      facade: "ldsp",
      unknown: ["size"],
    });
  });

  it("известные размеры снимают пометку «не знаю»", () => {
    const step = stepInputSchema.parse({ screen: "size", size: { mode: "known", widthCm: 300, heightCm: null, depthCm: 60 } });
    expect(applyStep(parseDetails({ unknown: ["size", "facade"] }), step)).toEqual({ widthCm: 300, depthCm: 60, unknown: ["facade"] });
  });

  it("материалы: у каждого поля значение или «не знаю», столешница может быть не нужна", () => {
    const step = stepInputSchema.parse({
      screen: "materials",
      facade: "unknown",
      countertop: "none",
      hardware: "soft_close",
      color: "Белый",
      extras: ["lighting"],
      description: "",
    });
    expect(applyStep(parseDetails({ widthCm: 300, facade: "ldsp", countertop: "quartz" }), step)).toEqual({
      widthCm: 300,
      hardware: "soft_close",
      color: "Белый",
      extras: ["lighting"],
      unknown: ["facade"],
    });
  });

  it("отправка: сегмент и адрес обязательны", () => {
    const base = { screen: "send", segment: "COMFORT", city: "Астана", address: "ул. Тестовая, 1", desiredDate: null, wishes: "" };
    expect(stepInputSchema.safeParse(base).success).toBe(true);
    expect(stepInputSchema.safeParse({ ...base, segment: null }).success).toBe(false);
    expect(stepInputSchema.safeParse({ ...base, address: "" }).success).toBe(false);
    expect(stepInputSchema.safeParse({ ...base, desiredDate: "31.12.2026" }).success).toBe(false);
  });
});
