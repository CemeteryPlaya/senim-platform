import type { Segment } from "@/generated/prisma/enums";
import { STYLES, type StyleKey } from "@/verticals/furniture";

/**
 * Фильтры каталога работ живут в адресе (/catalog?type=kitchen&style=loft&segment=COMFORT&price=300-700&page=2):
 * ссылкой можно поделиться, форма работает без JavaScript. Неизвестные значения молча отбрасываются.
 */
export const PRICE_BUCKETS = ["upto300", "300-700", "700-1500", "from1500"] as const;
export type PriceBucket = (typeof PRICE_BUCKETS)[number];

const RANGES: Record<PriceBucket, { gte?: number; lte?: number }> = {
  upto300: { lte: 300_000 },
  "300-700": { gte: 300_000, lte: 700_000 },
  "700-1500": { gte: 700_000, lte: 1_500_000 },
  from1500: { gte: 1_500_000 },
};

const SEGMENTS: readonly Segment[] = ["ECONOMY", "COMFORT", "PREMIUM"];

export type CatalogFilter = {
  type?: string;
  style?: StyleKey;
  segment?: Segment;
  price?: PriceBucket;
  page: number;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9-]{1,60}$/;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((a) => a === value);
}

export function parseCatalogFilter(params: SearchParams): CatalogFilter {
  const type = first(params.type);
  const page = Number(first(params.page));
  const filter: CatalogFilter = { page: Number.isInteger(page) && page >= 1 ? page : 1 };
  if (type && SLUG.test(type)) filter.type = type;
  const style = oneOf(first(params.style), Object.keys(STYLES) as StyleKey[]);
  if (style) filter.style = style;
  const segment = oneOf(first(params.segment), SEGMENTS);
  if (segment) filter.segment = segment;
  const price = oneOf(first(params.price), PRICE_BUCKETS);
  if (price) filter.price = price;
  return filter;
}

export function priceRange(bucket: PriceBucket): { gte?: number; lte?: number } {
  return RANGES[bucket];
}

/** Адрес каталога для фильтра (страница 1 не пишется). */
export function catalogHref(filter: CatalogFilter): string {
  const params = new URLSearchParams();
  for (const key of ["type", "style", "segment", "price"] as const) {
    const value = filter[key];
    if (value) params.set(key, value);
  }
  if (filter.page > 1) params.set("page", String(filter.page));
  const query = params.toString();
  return query ? `/catalog?${query}` : "/catalog";
}
