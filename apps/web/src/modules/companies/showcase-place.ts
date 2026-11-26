import type { ShowcaseAddress } from "@/generated/prisma/enums";

/**
 * Место оконченной сделки на публичных страницах (спека 2026-11-17, 3.5; ADR-016) — только по выбору покупателя
 * (DealShowcase.address) и только город заявки: район, ЖК, улица и дом не читаются никогда. Одно правило для истории
 * сделок мастера (deal-core) и работ портфолио из сделки (каталог, «Вдохновение», «Хочу похожее»).
 */

/** Что покупатель выбирает сейчас: не показывать или город. Значения DISTRICT и COMPLEX остались только в старых записях. */
export const SHOWCASE_ADDRESS_CHOICES = ["NONE", "CITY"] as const satisfies readonly ShowcaseAddress[];
export type ShowcaseAddressChoice = (typeof SHOWCASE_ADDRESS_CHOICES)[number];

/** Сохранённый выбор так, как он действует и показывается: прежние «город и район» и «город, район и ЖК» — город. */
export function shownAddressOf(saved: ShowcaseAddress): ShowcaseAddressChoice {
  return saved === "NONE" ? "NONE" : "CITY";
}

/** Место по выбору: NONE или пустой город — null, иначе город заявки. Без маски. */
export function placeOf(request: { city: string }, chosen: ShowcaseAddress): string | null {
  if (shownAddressOf(chosen) === "NONE") return null;
  const city = request.city.trim();
  return city === "" ? null : city;
}
