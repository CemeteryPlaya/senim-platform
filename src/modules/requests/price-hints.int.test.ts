import { describe, expect, it } from "vitest";
import type { Segment } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import type { TypicalEstimate } from "@/verticals/furniture";
import { makeClient } from "../../../test/factories";
import { makeExecutorWithTerms, makeFurnitureType, makeOpenRequest, offerInput } from "../../../test/factories/requests";
import { segmentPriceHints, sendOffer, withdrawOffer } from "./index";

describe("вилка цены на экране «Уровень»", () => {
  it("считается по откликам на заявки того же типа и уровня; отозванные и чужие типы не входят", async () => {
    const client = await makeClient();
    const kitchen = await makeFurnitureType("Кухня");
    const hallway = await makeFurnitureType("Прихожая");
    const comfort = await makeOpenRequest(client, { typeId: kitchen.id, segment: "COMFORT" });
    const premium = await makeOpenRequest(client, { typeId: kitchen.id, segment: "PREMIUM" });
    const otherType = await makeOpenRequest(client, { typeId: hallway.id, segment: "COMFORT" });

    for (const price of [600_000, 700_000, 800_000, 900_000]) {
      await sendOffer(await makeExecutorWithTerms("COMFORT"), offerInput(comfort, price));
    }
    const withdrawn = await makeExecutorWithTerms("COMFORT");
    const { offerId } = await sendOffer(withdrawn, offerInput(comfort, 5_000_000));
    await withdrawOffer(withdrawn, { offerId });
    await sendOffer(await makeExecutorWithTerms("COMFORT"), offerInput(otherType, 10_000));
    await sendOffer(await makeExecutorWithTerms("PREMIUM"), offerInput(premium, 2_000_000));

    expect(await segmentPriceHints(kitchen.id)).toEqual({
      ECONOMY: null,
      COMFORT: { source: "offers", from: 600_000, to: 800_000, count: 4 },
      // Один отклик — это цена конкретного исполнителя, вилку не показываем.
      PREMIUM: null,
    });
  });

  it("свой тип мебели — вилок нет", async () => {
    expect(await segmentPriceHints(null)).toEqual({ ECONOMY: null, COMFORT: null, PREMIUM: null });
  });
});

// ─── вилка по ценам материалов (ADR-007) ─────────────────────────────────────

const KITCHEN_ESTIMATE: TypicalEstimate = {
  productUnit: "lm",
  typicalWidthCm: 300,
  typicalHeightCm: 220,
  markup: 2,
  perUnit: [
    { category: "carcass", unit: "m2", quantity: 3 },
    { category: "facade", unit: "m2", quantity: 1.5 },
  ],
};

async function material(name: string, category: string, priceKzt: number, segments: Segment[], extra: { active?: boolean; isDemo?: boolean } = {}) {
  return db.materialPrice.create({ data: { name, category, unit: "m2", priceKzt, segments, ...extra } });
}

/** Эконом и комфорт — полный набор; для премиума фасада в справочнике нет. */
async function kitchenWithBook(opts: { demo?: boolean } = {}) {
  const kitchen = await makeFurnitureType("Кухня");
  const { perUnit, ...rest } = KITCHEN_ESTIMATE;
  await db.typicalEstimate.create({ data: { furnitureTypeId: kitchen.id, ...rest, perUnit, isDemo: opts.demo ?? false } });
  await material("ЛДСП эконом", "carcass", 4_000, ["ECONOMY"]);
  await material("ЛДСП Egger", "carcass", 6_000, ["COMFORT", "PREMIUM"]);
  const economyFacade = await material("ЛДСП-фасад", "facade", 5_000, ["ECONOMY"]);
  await material("Акрил", "facade", 20_000, ["COMFORT"]);
  await material("МДФ эмаль", "facade", 30_000, ["COMFORT"]);
  return { kitchen, economyFacade };
}

describe("вилка по ценам материалов и типовому расчёту", () => {
  it("размер известен: считает калькулятор, вилка округлена наружу до 10 000 ₸", async () => {
    const { kitchen } = await kitchenWithBook();
    const hints = await segmentPriceHints(kitchen.id, { widthCm: 200 });
    // Эконом: (3 × 4 000 + 1,5 × 5 000) × 2 п. м × 2 = 78 000.
    expect(hints.ECONOMY).toEqual({ source: "materials", from: 70_000, to: 80_000, typical: null, demo: false });
    // Комфорт: (18 000 + 30 000…45 000) × 2 × 2 = 192 000…252 000.
    expect(hints.COMFORT).toEqual({ source: "materials", from: 190_000, to: 260_000, typical: null, demo: false });
  });

  it("размер «не знаю» — по типовому размеру, и это видно в подсказке", async () => {
    const { kitchen } = await kitchenWithBook();
    const hints = await segmentPriceHints(kitchen.id, {});
    // (12 000 + 7 500) × 3 п. м × 2 = 117 000.
    expect(hints.ECONOMY).toEqual({
      source: "materials",
      from: 110_000,
      to: 120_000,
      typical: { productUnit: "lm", widthCm: 300, heightCm: 220 },
      demo: false,
    });
  });

  it("уровень без нужного материала — вилка по откликам, если их хватает", async () => {
    const { kitchen } = await kitchenWithBook();
    const client = await makeClient();
    const premium = await makeOpenRequest(client, { typeId: kitchen.id, segment: "PREMIUM" });
    for (const price of [2_000_000, 2_500_000, 3_000_000]) {
      await sendOffer(await makeExecutorWithTerms("PREMIUM"), offerInput(premium, price));
    }
    const hints = await segmentPriceHints(kitchen.id, { widthCm: 200 });
    expect(hints.PREMIUM).toEqual({ source: "offers", from: 2_000_000, to: 3_000_000, count: 3 });
    expect(hints.ECONOMY?.source).toBe("materials");
  });

  it("материал в архиве в расчёт не входит — без откликов вилки нет", async () => {
    const { kitchen, economyFacade } = await kitchenWithBook();
    await db.materialPrice.update({ where: { id: economyFacade.id }, data: { active: false } });
    const hints = await segmentPriceHints(kitchen.id, { widthCm: 200 });
    expect(hints.ECONOMY).toBeNull();
    expect(hints.COMFORT?.source).toBe("materials");
  });

  it("демонстрационный типовой расчёт или демо-цены — вилка помечена", async () => {
    const { kitchen } = await kitchenWithBook({ demo: true });
    expect((await segmentPriceHints(kitchen.id, { widthCm: 200 })).ECONOMY).toMatchObject({ source: "materials", demo: true });

    await db.typicalEstimate.update({ where: { furnitureTypeId: kitchen.id }, data: { isDemo: false } });
    await material("Фанера", "carcass", 9_000, ["COMFORT"], { isDemo: true });
    const hints = await segmentPriceHints(kitchen.id, { widthCm: 200 });
    // Пометка — у уровня, в расчёт которого вошла демо-цена.
    expect(hints.COMFORT).toMatchObject({ demo: true });
    expect(hints.ECONOMY).toMatchObject({ demo: false });
  });

  it("испорченный типовой расчёт не ломает мастер — вилка как без него", async () => {
    const { kitchen } = await kitchenWithBook();
    await db.typicalEstimate.update({ where: { furnitureTypeId: kitchen.id }, data: { perUnit: [{ category: "glass", unit: "m2", quantity: 1 }] } });
    expect(await segmentPriceHints(kitchen.id, { widthCm: 200 })).toEqual({ ECONOMY: null, COMFORT: null, PREMIUM: null });
  });
});
