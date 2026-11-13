import type { PortfolioCard } from "@/modules/companies";

/** То, что `WorkCard` берёт из работы портфолио (без адреса: его задаёт экран). */
export type WorkCardView = {
  id: string;
  title: string;
  /** «Тип · место» — только то, что карточка отдаёт публично. */
  meta: string;
  /** Тиыны. Нет цены — поля нет. */
  priceFrom?: bigint;
  /** Только загруженный снимок; иллюстрации сида из `public/` в карточку не идут (будет заглушка). */
  photo?: { src: string; alt: string };
};

/**
 * Корень статических иллюстраций сида: это не фото мастера. Правило держится на префиксе пути (провайдер хранилища в
 * `PhotoView` не приходит): другие статические пути потребуют правки здесь.
 */
const SEED_ILLUSTRATIONS = "/demo/";

/** Цена в модуле — целые тенге; в интерфейсе деньги — тиыны. */
export const toTiyn = (tenge: number): bigint => BigInt(Math.round(tenge)) * 100n;

/** Чистое отображение работы портфолио в данные карточки: каталог и профиль мастера показывают её одинаково. */
export function workCardView(card: PortfolioCard): WorkCardView {
  const cover = card.photos.find((p) => p.src !== null && !p.src.startsWith(SEED_ILLUSTRATIONS));
  return {
    id: card.id,
    title: card.title,
    meta: [card.furnitureType.name, card.place].filter(Boolean).join(" · "),
    // Ноль — «цена не указана», а не «бесплатно».
    ...(card.priceFrom !== null && card.priceFrom > 0 ? { priceFrom: toTiyn(card.priceFrom) } : {}),
    ...(cover?.src ? { photo: { src: cover.src, alt: cover.alt } } : {}),
  };
}

/**
 * Область изображения у всех карточек списка: если хотя бы у одной работы есть настоящее фото — у всех `slot`
 * (карточки одной высоты, без фото — заглушка), иначе `none` (компактные текстовые карточки).
 */
export function cardsMedia(cards: readonly Pick<WorkCardView, "photo">[]): "none" | "slot" {
  return cards.some((card) => card.photo) ? "slot" : "none";
}
