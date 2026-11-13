import { ru } from "@/i18n/ru";
import { catalogHref, PRICE_BUCKETS, type CatalogFilter, type PortfolioCard } from "@/modules/companies";
import { to } from "../../../_shell/paths";
import { workCardView, type WorkCardView } from "../../_parts/work-card";

const t = ru.app.guest.catalog;

/** То, что отдаёт `listCatalog`. */
export type CatalogResult = { items: PortfolioCard[]; total: number; page: number; pageCount: number };
export type CatalogFacets = { types: { slug: string; name: string }[] };

type Chip = { href: string; label: string; active: boolean };
type EmptyView = { title: string; body: string; action: { href: string; label: string } };

export type CardView = WorkCardView & {
  /** Профиль мастера: адрес v2. */
  href: string;
  /** Строка мастера: публичная метка модуля и отзывы, если есть. Больше ничего о мастере. */
  byline: string;
};

export type CatalogView = {
  state: "results" | "empty-filter" | "empty-catalogue" | "beyond";
  /** Чипы показываем, пока есть что фильтровать: пустой каталог без фильтра их не имеет. */
  showFilters: boolean;
  typeChips: Chip[];
  priceChips: Chip[];
  /** Строка «Найдено N работ»; без результатов — null. */
  found: string | null;
  cards: CardView[];
  /**
   * Вид карточек страницы: `slot` — если хотя бы у одной работы есть настоящее фото (у остальных ровная заглушка),
   * иначе `none` — компактные текстовые карточки.
   */
  media: "none" | "slot";
  /** Ссылка под списком результатов: «Не нашли похожее?»; без результатов — null. */
  similarLink: { href: string; label: string } | null;
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  /** Пустое состояние с единственным главным действием; при результатах — null. */
  empty: EmptyView | null;
};

const href = (filter: CatalogFilter): string => to(catalogHref(filter));

/** «Исполнитель №7 · 4,8 · 12 отзывов»; без отзывов — только метка. Из публичных полей `executor`, id не выводится. */
function byline(executor: PortfolioCard["executor"]): string {
  if (executor.reviewsCount <= 0) return executor.label;
  const rating = executor.ratingAvg > 0 ? executor.ratingAvg.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : null;
  return [executor.label, rating, t.reviews(executor.reviewsCount)].filter(Boolean).join(" · ");
}

function cardView(card: PortfolioCard): CardView {
  return { ...workCardView(card), href: to(`/executors/${card.executor.publicNumber}`), byline: byline(card.executor) };
}

/**
 * Чистая view-модель каталога: из результата модуля и фильтра — чипы, карточки, пагинация и пустое состояние.
 * Без ввода-вывода. Мастер в карточке — ссылка на публичный профиль и строка с публичной меткой модуля: контакты, id и юридическое имя сюда не попадают.
 */
export function catalogView(result: CatalogResult, facets: CatalogFacets, filter: CatalogFilter): CatalogView {
  const filtered = Boolean(filter.type || filter.style || filter.segment || filter.price);
  const hrefFor = (page: number): string => href({ ...filter, page });
  const base = { page: result.page, pageCount: result.pageCount, hrefFor };

  const state: CatalogView["state"] =
    result.items.length > 0 ? "results" : result.total > 0 ? "beyond" : filtered ? "empty-filter" : "empty-catalogue";

  // Тип, которого нет среди фасетов (выключен или выдуман в адресе), не выбирает ни один чип: активна «Все типы».
  const activeType = facets.types.some((type) => type.slug === filter.type) ? filter.type : undefined;
  const typeChips: Chip[] = [
    { href: href({ ...filter, type: undefined, page: 1 }), label: t.allTypes, active: !activeType },
    ...facets.types.map((type) => ({ href: href({ ...filter, type: type.slug, page: 1 }), label: type.name, active: activeType === type.slug })),
  ];
  const priceChips: Chip[] = [
    { href: href({ ...filter, price: undefined, page: 1 }), label: t.allPrices, active: !filter.price },
    ...PRICE_BUCKETS.map((price) => ({ href: href({ ...filter, price, page: 1 }), label: t.prices[price], active: filter.price === price })),
  ];

  const empty: EmptyView | null = {
    results: null,
    "empty-filter": { title: t.emptyFilter.title, body: t.emptyFilter.body, action: { href: to("/catalog"), label: t.emptyFilter.action } },
    "empty-catalogue": { title: t.emptyCatalogue.title, body: t.emptyCatalogue.body, action: { href: to("/"), label: t.emptyCatalogue.action } },
    beyond: { title: t.beyond.title, body: t.pagesInCatalogue(result.pageCount), action: { href: hrefFor(1), label: t.beyond.action } },
  }[state];

  const cards = result.items.map(cardView);
  return {
    state,
    showFilters: state !== "empty-catalogue",
    typeChips,
    priceChips,
    found: state === "results" ? t.found(result.total) : null,
    cards,
    media: cards.some((card) => card.photo) ? "slot" : "none",
    similarLink: state === "results" ? { href: to("/requests/new"), label: t.similarLink } : null,
    empty,
    ...base,
  };
}
