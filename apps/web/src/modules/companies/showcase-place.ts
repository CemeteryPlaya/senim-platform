import type { ShowcaseAddress } from "@/generated/prisma/enums";

/**
 * Место оконченной сделки на публичных страницах (спека 2026-11-17, 3.5) — только по выбору покупателя (DealShowcase.address)
 * и только из заявки: город, район, ЖК; улица и дом (Request.address) не читаются никогда. Одно правило для истории сделок
 * мастера (deal-core) и работ портфолио из сделки (каталог, «Вдохновение», «Хочу похожее»).
 */
export const ADDRESS_LEVELS: readonly ShowcaseAddress[] = ["NONE", "CITY", "DISTRICT", "COMPLEX"];

export type ShowcasePlaceSource = { city: string; district: string | null; complex: string | null };

const present = (s: string | null) => (s ?? "").trim() !== "";

/** Доступные варианты адреса: район — если он есть в заявке, ЖК — если есть и район, и ЖК. */
export function addressOptionsOf(request: { district: string | null; complex: string | null }): ShowcaseAddress[] {
  const options: ShowcaseAddress[] = ["NONE", "CITY"];
  if (present(request.district)) options.push("DISTRICT");
  if (present(request.district) && present(request.complex)) options.push("COMPLEX");
  return options;
}

/** Выбранный уровень адреса, пониженный до доступного по данным заявки (ЖК — только с районом); NONE — null. Без маски. */
export function placeOf(request: ShowcasePlaceSource, chosen: ShowcaseAddress): string | null {
  const options = addressOptionsOf(request);
  const level = ADDRESS_LEVELS.slice(0, ADDRESS_LEVELS.indexOf(chosen) + 1).findLast((l) => options.includes(l)) ?? "NONE";
  const parts = [request.city, request.district, request.complex]
    .slice(0, ADDRESS_LEVELS.indexOf(level))
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
