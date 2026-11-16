import type { Prisma } from "@/generated/prisma/client";
import type { Segment } from "@/generated/prisma/enums";
import type { MaterialCategory, MaterialUnit, TypicalEstimate } from "@/verticals/furniture";
import type { FurnitureSlug } from "./data";

/**
 * Справочник цен материалов и типовые расчёты стенда (ADR-007, ответ №33).
 * Это ориентир порядка цен в тенге, а не данные рынка: оператор заменит их реальными на экране «Цены материалов».
 * Типовые расчёты — тоже ориентир: количества материалов на единицу изделия и коэффициент «материалы → цена заказа»
 * нужно подтвердить у мебельщиков (вопрос владельцу).
 */

type SeedPrice = { category: MaterialCategory; name: string; unit: MaterialUnit; priceKzt: number; segments: Segment[] };

const E: Segment = "ECONOMY";
const C: Segment = "COMFORT";
const P: Segment = "PREMIUM";

export const SEED_MATERIAL_PRICES: readonly SeedPrice[] = [
  { category: "carcass", name: "ЛДСП 16 мм, стандартные декоры", unit: "m2", priceKzt: 4_200, segments: [E] },
  { category: "carcass", name: "ЛДСП 16 мм, Egger", unit: "m2", priceKzt: 6_500, segments: [C, P] },
  { category: "carcass", name: "Фанера берёзовая 18 мм", unit: "m2", priceKzt: 9_500, segments: [P] },
  { category: "carcass", name: "ЛДСП 16 мм, лист 2750 × 1830", unit: "sheet", priceKzt: 23_000, segments: [E, C] },
  { category: "facade", name: "ЛДСП 16 мм", unit: "m2", priceKzt: 4_500, segments: [E] },
  { category: "facade", name: "МДФ в плёнке ПВХ", unit: "m2", priceKzt: 18_000, segments: [C] },
  { category: "facade", name: "Акрил", unit: "m2", priceKzt: 30_000, segments: [C] },
  { category: "facade", name: "МДФ эмаль", unit: "m2", priceKzt: 35_000, segments: [C] },
  { category: "facade", name: "Шпон натуральный", unit: "m2", priceKzt: 60_000, segments: [P] },
  { category: "facade", name: "Массив дуба", unit: "m2", priceKzt: 95_000, segments: [P] },
  { category: "countertop", name: "ЛДСП-столешница 38 мм", unit: "lm", priceKzt: 9_000, segments: [E] },
  { category: "countertop", name: "Компакт-плита 12 мм", unit: "lm", priceKzt: 45_000, segments: [C] },
  { category: "countertop", name: "Искусственный камень", unit: "lm", priceKzt: 120_000, segments: [P] },
  { category: "countertop", name: "Кварцевый агломерат", unit: "lm", priceKzt: 160_000, segments: [P] },
  { category: "hardware", name: "Комплект на модуль: стандартные петли и направляющие", unit: "pcs", priceKzt: 6_000, segments: [E] },
  { category: "hardware", name: "Комплект на модуль: с доводчиками", unit: "pcs", priceKzt: 15_000, segments: [C] },
  { category: "hardware", name: "Комплект на модуль: Blum или Hettich", unit: "pcs", priceKzt: 40_000, segments: [P] },
  { category: "edge", name: "Кромка ПВХ 0,4 мм", unit: "lm", priceKzt: 150, segments: [E] },
  { category: "edge", name: "Кромка ПВХ 2 мм", unit: "lm", priceKzt: 350, segments: [C, P] },
  { category: "edge", name: "Кромка шпонированная", unit: "lm", priceKzt: 900, segments: [P] },
  { category: "other", name: "Задняя стенка ХДФ 3 мм", unit: "m2", priceKzt: 1_800, segments: [E, C, P] },
];

/** ДЕМО: материалы на единицу изделия. Кухня и прихожая — на 1 п. м, шкаф-купе — на 1 м² фасада. */
export const SEED_TYPICAL_ESTIMATES: Partial<Record<FurnitureSlug, TypicalEstimate>> = {
  kitchen: {
    productUnit: "lm",
    typicalWidthCm: 300,
    typicalHeightCm: 220,
    markup: 2.5,
    perUnit: [
      { category: "carcass", unit: "m2", quantity: 3.5 },
      { category: "facade", unit: "m2", quantity: 1.5 },
      { category: "countertop", unit: "lm", quantity: 1 },
      { category: "hardware", unit: "pcs", quantity: 1.7 },
      { category: "edge", unit: "lm", quantity: 12 },
      { category: "other", unit: "m2", quantity: 1.4 },
    ],
  },
  wardrobe: {
    productUnit: "front_m2",
    typicalWidthCm: 200,
    typicalHeightCm: 240,
    markup: 2.5,
    perUnit: [
      { category: "carcass", unit: "m2", quantity: 2.2 },
      { category: "facade", unit: "m2", quantity: 1 },
      { category: "hardware", unit: "pcs", quantity: 0.5 },
      { category: "edge", unit: "lm", quantity: 6 },
      { category: "other", unit: "m2", quantity: 1 },
    ],
  },
  hallway: {
    productUnit: "lm",
    typicalWidthCm: 150,
    typicalHeightCm: 220,
    markup: 2.5,
    perUnit: [
      { category: "carcass", unit: "m2", quantity: 3 },
      { category: "facade", unit: "m2", quantity: 1.2 },
      { category: "hardware", unit: "pcs", quantity: 1.5 },
      { category: "edge", unit: "lm", quantity: 10 },
      { category: "other", unit: "m2", quantity: 1 },
    ],
  },
};

/** Сид справочника. Таблицы пустые (seedStand в пустую базу, reseedStand после TRUNCATE). */
export async function seedMaterialPrices(tx: Prisma.TransactionClient, types: ReadonlyMap<FurnitureSlug, string>): Promise<void> {
  await tx.materialPrice.createMany({ data: [...SEED_MATERIAL_PRICES] });
  await tx.typicalEstimate.createMany({
    data: Object.entries(SEED_TYPICAL_ESTIMATES).map(([slug, { perUnit, ...estimate }]) => ({
      furnitureTypeId: types.get(slug as FurnitureSlug)!,
      ...estimate,
      perUnit,
    })),
  });
}
