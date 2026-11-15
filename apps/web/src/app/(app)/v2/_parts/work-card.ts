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

/** Снимок работы для галереи на весь экран: подпись — название работы. */
export type WorkPhoto = { src: string; alt: string; caption: string };

/** Верхняя граница снимков в галерее профиля: больше экран не листают, а страница тяжелеет. */
const GALLERY_LIMIT = 24;

const isUpload = (p: PortfolioCard["photos"][number]): p is { id: string; src: string; alt: string } => p.src !== null && !p.src.startsWith(SEED_ILLUSTRATIONS);

/**
 * Снимки всех работ мастера для мозаики и галереи: сначала обложка каждой работы (в порядке портфолио — первые три
 * видны плитками, и это три разные работы), затем остальные снимки работ. Только загруженные фото: иллюстрации сида
 * (`/demo/`) не показываются, как и в карточке работы.
 */
export function workGallery(cards: readonly PortfolioCard[]): WorkPhoto[] {
  const covers: WorkPhoto[] = [];
  const rest: WorkPhoto[] = [];
  for (const card of cards) {
    const photos = card.photos.filter(isUpload);
    photos.forEach((p, i) => (i === 0 ? covers : rest).push({ src: p.src, alt: p.alt, caption: card.title }));
  }
  return [...covers, ...rest].slice(0, GALLERY_LIMIT);
}
