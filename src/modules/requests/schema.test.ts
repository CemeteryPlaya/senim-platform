import { describe, expect, it } from "vitest";
import { applyStep, parseDetails, requestDetailsSchema, resumeIndex, screenIndex, segmentInputOf, stepInputSchema, WIZARD_SCREENS } from "./schema";

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

  it("уровень обязателен и только из списка", () => {
    expect(stepInputSchema.safeParse({ screen: "segment", segment: "COMFORT" }).success).toBe(true);
    expect(stepInputSchema.safeParse({ screen: "segment", segment: null }).success).toBe(false);
    expect(stepInputSchema.safeParse({ screen: "segment", segment: "GOLD" }).success).toBe(false);
  });

  it("помещение: фото и описание своими словами, описание попадает в details", () => {
    const step = stepInputSchema.parse({ screen: "room", photoFileIds: [], description: "  Угловая, до потолка  " });
    expect(applyStep(parseDetails({ widthCm: 300 }), step)).toEqual({ widthCm: 300, description: "Угловая, до потолка" });
    const empty = stepInputSchema.parse({ screen: "room", photoFileIds: [] });
    expect(applyStep(parseDetails({ description: "старое" }), empty)).toEqual({});
  });

  it("адрес: город и адрес обязательны, дата — по желанию", () => {
    const base = { screen: "place", city: "Астана", address: "ул. Тестовая, 1", desiredDate: null };
    expect(stepInputSchema.safeParse(base).success).toBe(true);
    expect(stepInputSchema.safeParse({ ...base, address: "" }).success).toBe(false);
    expect(stepInputSchema.safeParse({ ...base, city: "" }).success).toBe(false);
    expect(stepInputSchema.safeParse({ ...base, desiredDate: "31.12.2026" }).success).toBe(false);
  });

  it("отправка — без полей: всё уже сохранено на прошлых экранах", () => {
    expect(stepInputSchema.safeParse({ screen: "send" }).success).toBe(true);
    expect(stepInputSchema.safeParse({ screen: "send", segment: "COMFORT" }).success).toBe(false);
  });

  it("материалы — не экран мастера: их приносит помощник, прогресс мастера они не двигают", () => {
    expect(WIZARD_SCREENS).not.toContain("materials");
    expect(screenIndex("materials")).toBe(-1);
    expect(screenIndex("send")).toBe(WIZARD_SCREENS.length - 1);
  });
});

describe("с какого экрана продолжить черновик", () => {
  const full = { wizardStep: WIZARD_SCREENS.length, segment: "COMFORT", address: "ул. Тестовая, 1" };
  const at = (screen: (typeof WIZARD_SCREENS)[number]) => WIZARD_SCREENS.indexOf(screen);

  it("новый черновик — первый экран", () => {
    expect(resumeIndex(null, undefined)).toBe(0);
  });

  it("без запроса — последний сохранённый экран; дальше сохранённого не пускает", () => {
    expect(resumeIndex({ ...full, wizardStep: 2, segment: null, address: null }, undefined)).toBe(2);
    expect(resumeIndex({ ...full, wizardStep: 2, segment: null, address: null }, "place")).toBe(2);
    expect(resumeIndex({ ...full, wizardStep: 2, segment: null, address: null }, "type")).toBe(0);
    expect(resumeIndex(full, undefined)).toBe(at("send"));
    expect(resumeIndex(full, "style")).toBe(at("style"));
  });

  it("неизвестный экран в адресе — последний сохранённый", () => {
    expect(resumeIndex(full, "materials")).toBe(at("send"));
  });

  it("черновик прежнего мастера без уровня или адреса возвращается к этому экрану", () => {
    expect(resumeIndex({ wizardStep: 6, segment: null, address: null }, undefined)).toBe(at("segment"));
    expect(resumeIndex({ wizardStep: 6, segment: "ECONOMY", address: null }, "send")).toBe(at("place"));
  });
});
