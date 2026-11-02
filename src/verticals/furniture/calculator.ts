import { z } from "zod";
import type { Segment } from "@/generated/prisma/enums";
import { isMaterialCategory, isMaterialUnit, MATERIAL_CATEGORIES, MATERIAL_UNITS, PRODUCT_UNITS, type MaterialCategory, type MaterialUnit, type ProductUnit } from "./materials";

/**
 * Калькулятор стоимости по материалам (ADR-007). Чистые функции: на вход — перечень материалов
 * с количествами (BOM) и справочник цен оператора, на выход — сумма по каждому уровню с разбивкой.
 * Сейчас BOM получается из типового расчёта на единицу изделия; позже его будет оценивать ИИ
 * по описанию и фото (ответ №18), а считать — эта же функция.
 */

const SEGMENTS = ["ECONOMY", "COMFORT", "PREMIUM"] as const satisfies readonly Segment[];

/** Строка справочника цен: средняя рыночная цена в целых тенге за единицу. Только активные строки. */
export type MaterialPrice = {
  name: string;
  category: MaterialCategory;
  unit: MaterialUnit;
  priceKzt: number;
  segments: readonly Segment[];
};

/** Строка из базы → строка калькулятора. Неизвестная категория или единица — null (в расчёт не входит). */
export function materialPriceOf(row: { name: string; category: string; unit: string; priceKzt: number; segments: readonly Segment[] }): MaterialPrice | null {
  const { name, category, unit, priceKzt, segments } = row;
  return isMaterialCategory(category) && isMaterialUnit(unit) ? { name, category, unit, priceKzt, segments } : null;
}

/**
 * Позиция перечня: сколько нужно материала категории в единице. Материал подбирается по категории
 * и единице среди строк уровня; разные позиции одной категории в одной единице усредняются в вилку.
 */
export type BomLine = { category: MaterialCategory; unit: MaterialUnit; quantity: number };

export type CostLine = BomLine & {
  /** Материалы уровня, из которых взята вилка, — от дешёвого к дорогому. */
  materials: string[];
  priceMin: number;
  priceMax: number;
  costMin: number;
  costMax: number;
};

export type SegmentCost = { from: number; to: number; lines: CostLine[]; missing: BomLine[] };

function costLine(line: BomLine, candidates: readonly MaterialPrice[]): CostLine | null {
  const matched = candidates
    .filter((p) => p.category === line.category && p.unit === line.unit)
    .sort((a, b) => a.priceKzt - b.priceKzt || a.name.localeCompare(b.name, "ru"));
  if (matched.length === 0) return null;
  const priceMin = matched[0].priceKzt;
  const priceMax = matched[matched.length - 1].priceKzt;
  return {
    ...line,
    materials: matched.map((p) => p.name),
    priceMin,
    priceMax,
    costMin: Math.round(line.quantity * priceMin),
    costMax: Math.round(line.quantity * priceMax),
  };
}

function segmentCost(bom: readonly BomLine[], prices: readonly MaterialPrice[], segment: Segment): SegmentCost {
  const candidates = prices.filter((p) => p.segments.includes(segment));
  const result: SegmentCost = { from: 0, to: 0, lines: [], missing: [] };
  for (const line of bom) {
    const cost = costLine(line, candidates);
    if (!cost) {
      result.missing.push(line);
      continue;
    }
    result.lines.push(cost);
    result.from += cost.costMin;
    result.to += cost.costMax;
  }
  return result;
}

/** Стоимость материалов по каждому уровню. Неполный уровень — непустой `missing`. */
export function costByBom(bom: readonly BomLine[], prices: readonly MaterialPrice[]): Record<Segment, SegmentCost> {
  return Object.fromEntries(SEGMENTS.map((s) => [s, segmentCost(bom, prices, s)])) as Record<Segment, SegmentCost>;
}

// ─── типовой расчёт на единицу изделия ───────────────────────────────────────

const bomLineSchema = z.strictObject({
  category: z.enum(MATERIAL_CATEGORIES),
  unit: z.enum(MATERIAL_UNITS),
  quantity: z.number().positive().max(1_000),
});

/**
 * Типовой расчёт для типа мебели: сколько материалов уходит на единицу изделия (1 п. м кухни,
 * 1 м² фасада шкафа), типовой размер для заявок без размеров и коэффициент от стоимости материалов
 * к цене заказа (работа, доставка, монтаж). Хранится в TypicalEstimate; заполняет оператор.
 */
export const typicalEstimateSchema = z.strictObject({
  productUnit: z.enum(PRODUCT_UNITS),
  typicalWidthCm: z.number().int().min(10).max(2_000),
  typicalHeightCm: z.number().int().min(10).max(500),
  markup: z.number().min(1).max(10),
  perUnit: z.array(bomLineSchema).min(1).max(50),
});
export type TypicalEstimate = z.output<typeof typicalEstimateSchema>;

/** Размеры из заявки; «не знаю» — пусто. */
export type ProductSize = { widthCm?: number | null; heightCm?: number | null };

const QUANTITY_BY_UNIT: Record<ProductUnit, (w: number, h: number) => number> = {
  lm: (w) => w / 100,
  front_m2: (w, h) => (w * h) / 10_000,
};

const NEEDS_HEIGHT: Record<ProductUnit, boolean> = { lm: false, front_m2: true };

/** Сколько единиц изделия в заявке. Нет нужного размера — берётся типовой, и это помечается. */
export function productQuantity(estimate: TypicalEstimate, size: ProductSize): { quantity: number; typicalSize: boolean } {
  const width = size.widthCm ?? null;
  const height = NEEDS_HEIGHT[estimate.productUnit] ? (size.heightCm ?? null) : estimate.typicalHeightCm;
  return {
    quantity: QUANTITY_BY_UNIT[estimate.productUnit](width ?? estimate.typicalWidthCm, height ?? estimate.typicalHeightCm),
    typicalSize: width === null || height === null,
  };
}

export type OrderEstimate = {
  /** Примерная цена заказа: стоимость материалов × коэффициент, целые тенге. */
  from: number;
  to: number;
  /** Посчитано для типового размера, а не по размерам заявки. */
  typicalSize: boolean;
  /** Единиц изделия (п. м или м² фасада). */
  quantity: number;
  /** Разбивка по материалам на весь заказ, без коэффициента. */
  materials: SegmentCost;
};

/** Вилка заказа по каждому уровню. Уровень, где не хватает материала из справочника, — null. */
export function estimateOrder(estimate: TypicalEstimate, size: ProductSize, prices: readonly MaterialPrice[]): Record<Segment, OrderEstimate | null> {
  const { quantity, typicalSize } = productQuantity(estimate, size);
  const bom = estimate.perUnit.map((line) => ({ ...line, quantity: line.quantity * quantity }));
  const costs = costByBom(bom, prices);
  const order = (cost: SegmentCost): OrderEstimate | null =>
    cost.missing.length > 0
      ? null
      : { from: Math.round(cost.from * estimate.markup), to: Math.round(cost.to * estimate.markup), typicalSize, quantity, materials: cost };
  return Object.fromEntries(SEGMENTS.map((s) => [s, order(costs[s])])) as Record<Segment, OrderEstimate | null>;
}
