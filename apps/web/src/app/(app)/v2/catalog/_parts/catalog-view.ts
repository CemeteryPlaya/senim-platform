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
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  /** Пустое состояние с единственным главным действием; при результатах — null. */
  empty: EmptyView | null;
};

const href = (filter: CatalogFilter): string => to(catalogHref(filter));

function cardView(card: PortfolioCard): CardView {
  return { ...workCardView(card), href: to(`/executors/${card.executor.publicNumber}`) };
}

/**
 * Чистая view-модель каталога: из результата модуля и фильтра — чипы, карточки, пагинация и пустое состояние.
 * Без ввода-вывода. Мастер в карточке — только ссылка на публичный профиль: имя, метка и контакты сюда не попадают.
 */
export function catalogView(result: CatalogResult, facets: CatalogFacets, filter: CatalogFilter): CatalogView {
  const filtered = Boolean(filter.type || filter.style || filter.segment || filter.price);
  const hrefFor = (page: number): string => href({ ...filter, page });
  const base = { page: result.page, pageCount: result.pageCount, hrefFor };

  const state: CatalogView["state"] =
    result.items.length > 0 ? "results" : result.total > 0 ? "beyond" : filtered ? "empty-filter" : "empty-catalogue";

  const typeChips: Chip[] = [
    { href: href({ ...filter, type: undefined, page: 1 }), label: t.allTypes, active: !filter.type },
    ...facets.types.map((type) => ({ href: href({ ...filter, type: type.slug, page: 1 }), label: type.name, active: filter.type === type.slug })),
  ];
  const priceChips: Chip[] = [
    { href: href({ ...filter, price: undefined, page: 1 }), label: t.allPrices, active: !filter.price },
    ...PRICE_BUCKETS.map((price) => ({ href: href({ ...filter, price, page: 1 }), label: t.prices[price], active: filter.price === price })),
  ];

  const empty: EmptyView | null = {
    results: null,
    "empty-filter": { title: t.emptyFilter.title, body: t.emptyFilter.body, action: { href: to("/catalog"), label: t.emptyFilter.action } },
    "empty-catalogue": { title: t.emptyCatalogue.title, body: t.emptyCatalogue.body, action: { href: to("/"), label: t.emptyCatalogue.action } },
    beyond: { title: t.beyond.title, body: t.beyond.body, action: { href: hrefFor(1), label: t.beyond.action } },
  }[state];

  return {
    state,
    showFilters: state !== "empty-catalogue",
    typeChips,
    priceChips,
    found: state === "results" ? t.found(result.total) : null,
    cards: result.items.map(cardView),
    empty,
    ...base,
  };
}
