import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import {
  advancedFrom,
  CUSTOM,
  nextScreen,
  OTHER,
  parseExecutorNumber,
  readStep,
  segmentOptions,
  segmentPriceNote,
  sendFootnote,
  splitTypes,
  stepErrors,
  summaryRows,
  typeChoice,
  wizardBack,
  wizardHref,
} from "./steps";

const t = ru.app.requests.wizard;
const v = ru.requests.validation;

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of Array.isArray(value) ? value : [value]) fd.append(name, one);
  return fd;
};

const TYPES = [
  { id: "k", slug: "kitchen", name: "Кухня" },
  { id: "t", slug: "table", name: "Стол" },
  { id: "w", slug: "wardrobe", name: "Шкаф-купе" },
];

describe("адреса и шаги мастера", () => {
  it("wizardHref: черновик и шаг, до черновика — работа или номер мастера", () => {
    expect(wizardHref()).toBe("/v2/requests/new");
    expect(wizardHref({ draft: "d1", step: "room" })).toBe("/v2/requests/new?draft=d1&step=room");
    expect(wizardHref({ executor: 17 })).toBe("/v2/requests/new?executor=17");
    expect(wizardHref({ like: "p 1" })).toBe("/v2/requests/new?like=p+1");
  });

  it("nextScreen: по порядку пяти экранов, последний — снова последний; не экран мастера — первый", () => {
    expect(["start", "segment", "room", "place", "send"].map(nextScreen)).toEqual(["segment", "room", "place", "send", "send"]);
    expect(nextScreen("materials")).toBe("start");
  });

  it("«Назад»: с первого шага и до черновика — «Заявки», дальше — прошлый шаг с его названием", () => {
    expect(wizardBack(0, "d1")).toEqual({ href: "/v2/requests", label: t.backToList });
    expect(wizardBack(2, null)).toEqual({ href: "/v2/requests", label: t.backToList });
    expect(wizardBack(3, "d1")).toEqual({ href: "/v2/requests/new?draft=d1&step=room", label: t.steps[2] });
  });

  it("номер мастера из адреса: только целое положительное", () => {
    expect(parseExecutorNumber("17")).toBe(17);
    for (const raw of [undefined, "", "0", "-3", "1.5", "17abc", "1e3", "1234567890"]) expect(parseExecutorNumber(raw)).toBeNull();
  });
});

describe("разбор формы шага и ошибки у полей", () => {
  it("шаг 1: плитка, «Другое» → тип из списка, «Свой вариант» → текст; стиль «не важно» — null", () => {
    expect(readStep("start", form({ furnitureType: "k", style: "" }))).toEqual({ screen: "start", furnitureTypeId: "k", customType: null, style: null, advanced: null });
    expect(readStep("start", form({ furnitureType: OTHER, furnitureTypeOther: "t", style: "loft" }))).toMatchObject({ furnitureTypeId: "t", customType: null, style: "loft" });
    expect(readStep("start", form({ furnitureType: OTHER, furnitureTypeOther: CUSTOM, customType: "Кровать-чердак" }))).toMatchObject({
      furnitureTypeId: null,
      customType: "Кровать-чердак",
    });
  });

  it("шаг 1: без выбора — ошибка у типа; размеры открыты — ошибка у ширины по имени поля", () => {
    expect(stepErrors("start", form({}))).toEqual({ furnitureTypeId: v.typeRequired });
    expect(stepErrors("start", form({ furnitureType: OTHER, furnitureTypeOther: CUSTOM, customType: "" }))).toEqual({ furnitureTypeId: v.typeRequired });
    const advanced = { furnitureType: "k", advanced: "1", sizeMode: "known", widthCm: "abc", facade: "unknown", countertop: "none", hardware: "unknown" };
    expect(stepErrors("start", form(advanced))).toEqual({ widthCm: v.size });
    expect(stepErrors("start", form({ ...advanced, widthCm: "300" }))).toBeNull();
    expect(readStep("start", form({ ...advanced, widthCm: "300", heightCm: "" }))).toMatchObject({
      advanced: { size: { mode: "known", widthCm: 300, heightCm: null, depthCm: null }, facade: "unknown", countertop: "none" },
    });
  });

  it("шаг 2: уровень обязателен", () => {
    expect(stepErrors("segment", form({}))).toEqual({ segment: v.segmentRequired });
    expect(stepErrors("segment", form({ segment: "COMFORT" }))).toBeNull();
  });

  it("шаг 3: фото — id загруженных файлов по порядку; всё необязательно", () => {
    expect(readStep("room", form({ photoFileIds: ["a", "b"], description: "до потолка" }))).toEqual({ screen: "room", photoFileIds: ["a", "b"], description: "до потолка" });
    expect(stepErrors("room", form({}))).toBeNull();
  });

  it("шаг 4: город и адрес у своих полей; точка — обе координаты или ни одной", () => {
    expect(stepErrors("place", form({ city: "", address: "" }))).toEqual({ city: v.cityRequired, address: v.addressRequired });
    expect(readStep("place", form({ city: "Астана", address: "ул. Достык, 5", desiredDate: "", lat: "51.1", lng: "71.4" }))).toEqual({
      screen: "place",
      city: "Астана",
      address: "ул. Достык, 5",
      desiredDate: null,
      location: { lat: 51.1, lng: 71.4 },
    });
    expect(readStep("place", form({ city: "Астана", address: "ул. Достык, 5", lat: "51.1" }))).toMatchObject({ location: null });
    expect(stepErrors("place", form({ city: "Астана", address: "ул. Достык, 5", lat: "999", lng: "71.4" }))).toEqual({ location: v.location });
  });
});

describe("начальные значения", () => {
  it("частые заказы — по порядку справочника вертикали, остальное — под «Другое»", () => {
    expect(splitTypes(TYPES)).toEqual({ popular: [TYPES[0], TYPES[2]], rest: [TYPES[1]] });
  });

  it("выбор типа из черновика", () => {
    expect(typeChoice(TYPES, { furnitureTypeId: "k", customType: null })).toEqual({ main: "k", sub: "", custom: "" });
    expect(typeChoice(TYPES, { furnitureTypeId: "t", customType: null })).toEqual({ main: OTHER, sub: "t", custom: "" });
    expect(typeChoice(TYPES, { furnitureTypeId: null, customType: "Кровать" })).toEqual({ main: OTHER, sub: CUSTOM, custom: "Кровать" });
    expect(typeChoice(TYPES, { furnitureTypeId: null, customType: null })).toEqual({ main: "", sub: "", custom: "" });
  });

  it("размеры и материалы: блок открыт, если что-то указано; столешница при фасадах без неё — «не нужна»", () => {
    expect(advancedFrom({})).toMatchObject({ open: false, sizeKnown: false, facade: "unknown", countertop: "unknown" });
    expect(advancedFrom({ widthCm: 240, facade: "ldsp" })).toMatchObject({ open: true, sizeKnown: true, width: "240", facade: "ldsp", countertop: "none" });
    expect(advancedFrom({ unknown: ["size"] })).toMatchObject({ open: true, sizeKnown: false });
  });
});

describe("уровень", () => {
  const prices = {
    ECONOMY: null,
    COMFORT: { source: "offers" as const, from: 400_000, to: 900_000, count: 4 },
    PREMIUM: { source: "materials" as const, from: 1, to: 2, typical: null, demo: true },
  };

  it("цена — только по предложениям мастеров; подсказка по материалам (флаг) не показывается", () => {
    const [economy, comfort, premium] = segmentOptions(prices);
    expect(economy.description).toContain(t.segment.noPrice);
    expect(comfort.description).toContain(t.segment.price(formatMoney(40_000_000n), formatMoney(90_000_000n)));
    expect(premium.description).toContain(t.segment.noPrice);
    expect(JSON.stringify(segmentOptions(prices))).not.toMatch(/демо/i);
    expect(segmentPriceNote(prices)).toBe(t.segment.priceNote(4));
    expect(segmentPriceNote({ ECONOMY: null, COMFORT: null, PREMIUM: null })).toBeNull();
  });
});

describe("сводка", () => {
  const draft = {
    id: "d1",
    title: "Кухня",
    style: "loft",
    details: { widthCm: 300, depthCm: 60, facade: "ldsp" as const, description: "до потолка" },
    segment: "COMFORT" as const,
    photos: [{ id: "f1", src: "/x.jpg" }],
    city: "Астана",
    address: "ул. Достык, 5",
    desiredDate: null,
  };

  it("каждая строка ведёт на свой шаг; материалы — только указанные", () => {
    const rows = summaryRows(draft);
    const s = t.send;
    expect(rows.map((r) => [r.label, r.value, r.href.split("step=")[1]])).toEqual([
      [s.type, "Кухня", "start"],
      [s.style, "Лофт", "start"],
      [s.size, s.sizeValue(300, undefined, 60), "start"],
      [s.facade, "ЛДСП", "start"],
      [s.segment, "Комфорт", "segment"],
      [s.photos, s.photosCount(1), "room"],
      [s.description, "до потолка", "room"],
      [s.address, "Астана, ул. Достык, 5", "place"],
      [s.date, s.notSet, "place"],
    ]);
  });

  it("без размеров — «уточнит замер», без стиля — «не важно», без фото — «без фото»", () => {
    const rows = summaryRows({ ...draft, style: null, details: {}, photos: [] });
    expect(rows.find((r) => r.label === t.send.size)?.value).toBe(t.start.sizeUnknown);
    expect(rows.find((r) => r.label === t.send.style)?.value).toBe(t.start.styleAny);
    expect(rows.find((r) => r.label === t.send.photos)?.value).toBe(t.send.noPhotos);
  });

  it("сноска: прямой заявке — кто её увидит, тендеру — мастера уровня", () => {
    expect(sendFootnote("COMFORT", null)).toBe(t.send.footnote("Комфорт"));
    expect(sendFootnote("COMFORT", "Исполнитель №17")).toBe(t.send.footnoteDirect("Исполнитель №17"));
  });
});

describe("тексты мастера", () => {
  it("нет запрещённых слов", () => {
    expect(JSON.stringify(ru.app.requests)).not.toMatch(/демо|комисси|эскроу|тестов|платформ/i);
  });
});
