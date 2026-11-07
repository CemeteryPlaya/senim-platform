import { STYLES, type StyleKey } from "@/verticals/furniture";
import type { SearchParams } from "./catalog-filter";

/**
 * Фильтр «Вдохновения» живёт в адресе (/inspiration?type=kitchen&style=loft&n=24): ссылкой можно поделиться,
 * чипы — обычные ссылки, «Показать ещё» работает без JavaScript. n — сколько работ показать (порциями по STEP).
 */
export const INSPIRATION_STEP = 12;
export const INSPIRATION_MAX = 96;

export type InspirationFilter = { type?: string; style?: StyleKey; limit: number };

const SLUG = /^[a-z0-9-]{1,60}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseInspirationFilter(params: SearchParams): InspirationFilter {
  const filter: InspirationFilter = { limit: limitOf(first(params.n)) };
  const type = first(params.type);
  if (type && SLUG.test(type)) filter.type = type;
  const style = first(params.style);
  if (style && style in STYLES) filter.style = style as StyleKey;
  return filter;
}

function limitOf(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < INSPIRATION_STEP) return INSPIRATION_STEP;
  return Math.min(n, INSPIRATION_MAX);
}

export function inspirationHref(filter: InspirationFilter): string {
  const params = new URLSearchParams();
  if (filter.type) params.set("type", filter.type);
  if (filter.style) params.set("style", filter.style);
  if (filter.limit > INSPIRATION_STEP) params.set("n", String(filter.limit));
  const query = params.toString();
  return query ? `/inspiration?${query}` : "/inspiration";
}
