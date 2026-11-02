import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import { logger } from "@/platform/logger";
import {
  estimateOrder,
  materialPriceOf,
  typicalEstimateSchema,
  type MaterialPrice,
  type OrderEstimate,
  type ProductSize,
  type ProductUnit,
  type TypicalEstimate,
} from "@/verticals/furniture";
import { priceRange, roundOutward } from "./price-range";
import { SEGMENTS } from "./schema";

/**
 * Подсказка цены уровня на экране «Уровень» мастера. Источник виден заказчику:
 * - `materials` — по ценам материалов из справочника оператора и типовому расчёту (ADR-007);
 *   `typical` — размеров в заявке нет, посчитано для типового размера; `demo` — в расчёт вошли демо-цифры;
 * - `offers` — по настоящим откликам на заявки того же типа мебели.
 */
export type PriceHint =
  | { source: "materials"; from: number; to: number; typical: { productUnit: ProductUnit; widthCm: number; heightCm: number } | null; demo: boolean }
  | { source: "offers"; from: number; to: number; count: number };

export type SegmentPriceHints = Record<Segment, PriceHint | null>;

const EMPTY: SegmentPriceHints = { ECONOMY: null, COMFORT: null, PREMIUM: null };

type Book = { estimate: TypicalEstimate; estimateDemo: boolean; prices: (MaterialPrice & { isDemo: boolean })[] };

/** Типовой расчёт для типа мебели и активные цены материалов. Испорченный расчёт — как будто его нет. */
async function loadBook(furnitureTypeId: string): Promise<Book | null> {
  const row = await db.typicalEstimate.findUnique({ where: { furnitureTypeId } });
  if (!row) return null;
  const parsed = typicalEstimateSchema.safeParse({
    productUnit: row.productUnit,
    typicalWidthCm: row.typicalWidthCm,
    typicalHeightCm: row.typicalHeightCm,
    markup: row.markup,
    perUnit: row.perUnit,
  });
  if (!parsed.success) {
    logger.warn("requests.price_hints.bad_typical_estimate", { furnitureTypeId, issues: parsed.error.issues.length });
    return null;
  }
  const rows = await db.materialPrice.findMany({
    where: { active: true },
    select: { name: true, category: true, unit: true, priceKzt: true, segments: true, isDemo: true },
  });
  const prices = rows.flatMap((r) => {
    const price = materialPriceOf(r);
    return price ? [{ ...price, isDemo: r.isDemo }] : [];
  });
  return { estimate: parsed.data, estimateDemo: row.isDemo, prices };
}

/** В расчёт уровня вошла демо-цифра: демо-расчёт или демо-цена материала, подходящая под его позиции. */
function usesDemo(book: Book, segment: Segment): boolean {
  if (book.estimateDemo) return true;
  return book.prices.some(
    (p) => p.isDemo && p.segments.includes(segment) && book.estimate.perUnit.some((l) => l.category === p.category && l.unit === p.unit),
  );
}

function materialsHint(book: Book, segment: Segment, order: OrderEstimate): PriceHint {
  const { estimate } = book;
  return {
    source: "materials",
    ...roundOutward(order.from, order.to),
    typical: order.typicalSize ? { productUnit: estimate.productUnit, widthCm: estimate.typicalWidthCm, heightCm: estimate.typicalHeightCm } : null,
    demo: usesDemo(book, segment),
  };
}

/** Вилки по откликам на заявки площадки с тем же типом мебели (отозванные не считаются). */
async function offerRanges(furnitureTypeId: string): Promise<SegmentPriceHints> {
  const offers = await db.offer.findMany({
    where: { status: { not: "WITHDRAWN" }, request: { furnitureTypeId, segment: { not: null } } },
    select: { price: true, request: { select: { segment: true } } },
  });
  return Object.fromEntries(
    SEGMENTS.map((segment) => {
      const range = priceRange(offers.filter((o) => o.request.segment === segment).map((o) => o.price));
      return [segment, range && { source: "offers", ...range }];
    }),
  ) as SegmentPriceHints;
}

/**
 * Вилки цены по уровням для экрана «Уровень» мастера (ответ №33). Для каждого уровня по порядку:
 * калькулятор по ценам материалов (если есть типовой расчёт и все материалы уровня) → настоящие отклики
 * (от трёх) → нет вилки («Цену назовут исполнители в откликах»). Свой тип мебели — вилок нет.
 */
export async function segmentPriceHints(furnitureTypeId: string | null, size: ProductSize = {}): Promise<SegmentPriceHints> {
  if (!furnitureTypeId) return EMPTY;
  const [book, offers] = await Promise.all([loadBook(furnitureTypeId), offerRanges(furnitureTypeId)]);
  const orders = book ? estimateOrder(book.estimate, size, book.prices) : null;
  return Object.fromEntries(
    SEGMENTS.map((segment) => {
      const order = orders?.[segment];
      return [segment, book && order ? materialsHint(book, segment, order) : offers[segment]];
    }),
  ) as SegmentPriceHints;
}
