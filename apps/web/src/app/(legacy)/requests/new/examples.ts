import "server-only";
import { listInspiration } from "@/modules/companies";
import { STYLE_KEYS } from "@/modules/requests";
import type { StyleKey } from "@/verticals/furniture";

// Примеры «Какой примерно вид?» мастера заявки: настоящие фото работ из «Вдохновения», иначе демо-иллюстрации.
// Только сервер (читает «Вдохновение»); картинки плиток «Что нужно?» — в images.ts.

/** Пример стиля, когда во «Вдохновении» нет работы этого стиля для выбранного типа мебели. */
const STYLE_FALLBACK: Readonly<Record<StyleKey, string>> = {
  modern: "/demo/portfolio/kitchen-sage.svg",
  minimalism: "/demo/portfolio/wardrobe-white.svg",
  scandi: "/demo/portfolio/tv-zone-scandi.svg",
  loft: "/demo/portfolio/shelving-loft.svg",
  neoclassic: "/demo/portfolio/kitchen-neoclassic.svg",
  classic: "/demo/portfolio/office-walnut.svg",
};

export type StyleExample = { style: StyleKey; src: string };

/**
 * По одному примеру на стиль: фото настоящей работы того же типа мебели из «Вдохновения» (сначала подборка
 * площадки), иначе иллюстрация стиля. Заказчик выбирает картинку, стиль выводится из неё.
 */
export async function styleExamples(typeSlug: string | null): Promise<StyleExample[]> {
  const { items } = typeSlug ? await listInspiration({ type: typeSlug, limit: 48 }) : { items: [] };
  return STYLE_KEYS.map((style) => ({
    style,
    src: items.find((tile) => tile.style.key === style && tile.cover?.src)?.cover?.src ?? STYLE_FALLBACK[style],
  }));
}
