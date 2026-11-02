import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import { priceRange, type PriceRange } from "./price-range";
import { SEGMENTS } from "./schema";

export type SegmentPriceHints = Record<Segment, PriceRange | null>;

/**
 * Вилки цены по уровням для экрана «Уровень» мастера: по откликам на заявки площадки с тем же типом мебели
 * (отозванные не считаются). Только настоящие цены; свой тип мебели или мало откликов — вилки нет.
 */
export async function segmentPriceHints(furnitureTypeId: string | null): Promise<SegmentPriceHints> {
  const empty: SegmentPriceHints = { ECONOMY: null, COMFORT: null, PREMIUM: null };
  if (!furnitureTypeId) return empty;
  const offers = await db.offer.findMany({
    where: { status: { not: "WITHDRAWN" }, request: { furnitureTypeId, segment: { not: null } } },
    select: { price: true, request: { select: { segment: true } } },
  });
  return Object.fromEntries(
    SEGMENTS.map((segment) => [segment, priceRange(offers.filter((o) => o.request.segment === segment).map((o) => o.price))]),
  ) as SegmentPriceHints;
}
