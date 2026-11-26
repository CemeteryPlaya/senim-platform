import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { applyStep, dealAddressSchema, parseDetails, requestDetailsSchema, resumeIndex, screenIndex, segmentInputOf, stepInputSchema, WIZARD_SCREENS } from "./schema";

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

  it("помещение: без полей проекта (форма v1) — поля не появляются, файлы проекта не трогаются", () => {
    const step = stepInputSchema.parse({ screen: "room", photoFileIds: [] });
    expect(step).not.toHaveProperty("designFileIds");
    expect(step).not.toHaveProperty("designContactsConfirmed");
  });

  it("помещение: файлы дизайн-проекта без отметки «убрал контакты» — ошибка у отметки; с отметкой — верно", () => {
    const noMark = stepInputSchema.safeParse({ screen: "room", photoFileIds: [], designFileIds: ["f1"] });
    expect(noMark.success).toBe(false);
    expect(noMark.error?.issues).toEqual([
      expect.objectContaining({ path: ["designContactsConfirmed"], message: ru.requests.validation.designContactsRequired }),
    ]);
    expect(stepInputSchema.safeParse({ screen: "room", photoFileIds: [], designFileIds: ["f1"], designContactsConfirmed: true }).success).toBe(true);
    // Отметка без файлов не мешает.
    expect(stepInputSchema.safeParse({ screen: "room", photoFileIds: [], designFileIds: [], designContactsConfirmed: true }).success).toBe(true);
  });

  it("помещение: не больше 5 файлов дизайн-проекта", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
    expect(stepInputSchema.safeParse({ screen: "room", photoFileIds: [], designFileIds: ids(5), designContactsConfirmed: true }).success).toBe(true);
    const six = stepInputSchema.safeParse({ screen: "room", photoFileIds: [], designFileIds: ids(6), designContactsConfirmed: true });
    expect(six.success).toBe(false);
    expect(six.error?.issues).toEqual([expect.objectContaining({ path: ["designFileIds"], message: ru.requests.validation.designTooMany })]);
  });

  it("«Где и когда» (ADR-016): город обязателен, дата — по желанию; адреса, точки, района и ЖК в шаге нет", () => {
    const base = { screen: "place", city: "Астана", desiredDate: null };
    expect(stepInputSchema.safeParse(base).success).toBe(true);
    expect(stepInputSchema.safeParse({ ...base, city: "" }).success).toBe(false);
    expect(stepInputSchema.safeParse({ ...base, desiredDate: "31.12.2026" }).success).toBe(false);
    for (const extra of [{ address: "ул. Тестовая, 1" }, { location: { lat: 51.128, lng: 71.43 } }, { district: "Есиль" }, { complex: "ЖК" }]) {
      expect(stepInputSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  it("адрес сделки: 5–200 знаков, точка — по желанию, обе координаты в пределах Земли", () => {
    const base = { dealId: "d1", address: "ул. Тестовая, 1" };
    expect(dealAddressSchema.parse(base)).toEqual({ ...base, location: null });
    expect(dealAddressSchema.parse({ ...base, address: "  ул. Абая, 1  " }).address).toBe("ул. Абая, 1");
    const short = dealAddressSchema.safeParse({ ...base, address: " ул " });
    expect(short.error?.issues).toEqual([expect.objectContaining({ path: ["address"], message: ru.requests.validation.dealAddressRequired })]);
    expect(dealAddressSchema.safeParse({ ...base, address: "у".repeat(201) }).success).toBe(false);
    expect(dealAddressSchema.safeParse({ ...base, location: { lat: 51.128, lng: 71.43 } }).success).toBe(true);
    expect(dealAddressSchema.safeParse({ ...base, location: { lat: 51.128 } }).success).toBe(false);
    expect(dealAddressSchema.safeParse({ ...base, location: { lat: 91, lng: 71.43 } }).success).toBe(false);
    expect(dealAddressSchema.safeParse({ ...base, location: { lat: 51.128, lng: 181 } }).success).toBe(false);
    expect(dealAddressSchema.safeParse({ ...base, dealId: "" }).success).toBe(false);
  });

  it("первый экран — только тип и стиль; блок «Для продвинутых» необязателен", () => {
    const start = { screen: "start", furnitureTypeId: "t1", customType: null, style: "loft", advanced: null };
    expect(stepInputSchema.safeParse(start).success).toBe(true);
    expect(stepInputSchema.safeParse({ ...start, style: null }).success).toBe(true);
    expect(stepInputSchema.safeParse({ ...start, furnitureTypeId: null }).success).toBe(false);
    expect(applyStep(parseDetails({ widthCm: 300, facade: "ldsp", styleNote: "светлее" }), stepInputSchema.parse(start))).toEqual({
      widthCm: 300,
      facade: "ldsp",
      styleNote: "светлее",
    });
  });

  it("«Для продвинутых»: размеры и материалы с «не знаю» у каждого технического поля", () => {
    const step = stepInputSchema.parse({
      screen: "start",
      furnitureTypeId: "t1",
      customType: null,
      style: null,
      advanced: { size: { mode: "known", widthCm: 280, heightCm: null, depthCm: 60 }, facade: "mdf_film", countertop: "unknown", hardware: "unknown" },
    });
    expect(applyStep(parseDetails({ unknown: ["size"], color: "Белый" }), step)).toEqual({
      widthCm: 280,
      depthCm: 60,
      facade: "mdf_film",
      color: "Белый",
      unknown: ["countertop", "hardware"],
    });
  });

  it("отправка — без полей: всё уже сохранено на прошлых экранах", () => {
    expect(stepInputSchema.safeParse({ screen: "send" }).success).toBe(true);
    expect(stepInputSchema.safeParse({ screen: "send", segment: "COMFORT" }).success).toBe(false);
  });

  it("экраны: первый — тип и стиль; размеры и материалы — не экраны, прогресс мастера они не двигают", () => {
    expect(WIZARD_SCREENS[0]).toBe("start");
    for (const step of ["type", "style", "size", "materials"] as const) {
      expect(WIZARD_SCREENS).not.toContain(step);
      expect(screenIndex(step)).toBe(-1);
    }
    expect(screenIndex("send")).toBe(WIZARD_SCREENS.length - 1);
  });
});

describe("с какого экрана продолжить черновик", () => {
  const full = { wizardStep: WIZARD_SCREENS.length, segment: "COMFORT", typeChosen: true };
  const at = (screen: (typeof WIZARD_SCREENS)[number]) => WIZARD_SCREENS.indexOf(screen);

  it("новый черновик — первый экран", () => {
    expect(resumeIndex(null, undefined)).toBe(0);
  });

  it("без запроса — последний сохранённый экран; дальше сохранённого не пускает", () => {
    expect(resumeIndex({ ...full, wizardStep: 2, segment: null }, undefined)).toBe(at("segment"));
    expect(resumeIndex({ ...full, wizardStep: 1, segment: null }, "place")).toBe(at("segment"));
    expect(resumeIndex({ ...full, wizardStep: 2, segment: "ECONOMY" }, "start")).toBe(0);
    expect(resumeIndex(full, undefined)).toBe(at("send"));
    expect(resumeIndex(full, "room")).toBe(at("room"));
  });

  it("неизвестный экран в адресе — последний сохранённый", () => {
    expect(resumeIndex(full, "materials")).toBe(at("send"));
  });

  it("черновик прежнего мастера без типа или уровня возвращается к этому экрану; без адреса — нет (ADR-016)", () => {
    expect(resumeIndex({ wizardStep: 6, segment: null, typeChosen: true }, undefined)).toBe(at("segment"));
    expect(resumeIndex({ wizardStep: 6, segment: "ECONOMY", typeChosen: true }, "send")).toBe(at("send"));
    expect(resumeIndex({ wizardStep: 6, segment: "ECONOMY", typeChosen: false }, "send")).toBe(0);
  });
});
