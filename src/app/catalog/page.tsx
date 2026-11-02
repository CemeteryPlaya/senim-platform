import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, SearchX } from "lucide-react";
import { ru } from "@/i18n/ru";
import { catalogHref, getCatalogFacets, listCatalog, parseCatalogFilter, PRICE_BUCKETS, type CatalogFilter, type SearchParams } from "@/modules/companies";
import { Button, ButtonLink, Container, EmptyState, PageHeader, Select } from "@/ui";
import { SEGMENT_NAMES, STYLES } from "@/verticals/furniture";
import { WorkCard } from "./_components/WorkCard";

const t = ru.companies.catalog;

export const metadata: Metadata = { title: t.title };

/** Каталог работ: фильтры в адресе (форма GET работает без JavaScript), карточки с «Хочу похожее». Доступен и гостю. */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filter = parseCatalogFilter(await searchParams);
  const [{ items, total, page, pageCount }, facets] = await Promise.all([listCatalog(filter), getCatalogFacets()]);
  const filtered = Boolean(filter.type || filter.style || filter.segment || filter.price);

  return (
    <Container className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />

      <section aria-labelledby="catalog-filters" className="rounded-card bg-sunken p-4 sm:p-5">
        <h2 id="catalog-filters" className="sr-only">
          {t.filters.label}
        </h2>
        <form method="get" action="/catalog" className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label={t.filters.type}
              name="type"
              defaultValue={filter.type ?? ""}
              placeholder={t.filters.any}
              options={facets.types.map((ft) => ({ value: ft.slug, label: ft.name }))}
            />
            <Select
              label={t.filters.style}
              name="style"
              defaultValue={filter.style ?? ""}
              placeholder={t.filters.any}
              options={Object.entries(STYLES).map(([value, s]) => ({ value, label: s.name }))}
            />
            <Select
              label={t.filters.segment}
              name="segment"
              defaultValue={filter.segment ?? ""}
              placeholder={t.filters.any}
              options={Object.entries(SEGMENT_NAMES).map(([value, label]) => ({ value, label }))}
            />
            <Select
              label={t.filters.price}
              name="price"
              defaultValue={filter.price ?? ""}
              placeholder={t.filters.anyPrice}
              options={PRICE_BUCKETS.map((value) => ({ value, label: t.filters.prices[value] }))}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit">{t.filters.apply}</Button>
            {filtered && (
              <ButtonLink href="/catalog" variant="ghost">
                {t.filters.reset}
              </ButtonLink>
            )}
          </div>
        </form>
      </section>

      {items.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={t.empty.title}
          description={t.empty.text}
          action={<ButtonLink href="/requests/new">{t.empty.action}</ButtonLink>}
        />
      ) : (
        <section aria-labelledby="catalog-results" className="flex flex-col gap-4">
          <h2 id="catalog-results" className="text-lg font-semibold text-ink">
            {t.found(total)}
          </h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))]">
            {items.map((card) => (
              <li key={card.id}>
                <WorkCard card={card} />
              </li>
            ))}
          </ul>
          {pageCount > 1 && <Pagination filter={filter} page={page} pageCount={pageCount} />}
        </section>
      )}
    </Container>
  );
}

function Pagination({ filter, page, pageCount }: { filter: CatalogFilter; page: number; pageCount: number }) {
  const p = t.pagination;
  return (
    <nav aria-label={p.label} className="flex flex-wrap items-center justify-between gap-3 pt-2">
      {page > 1 ? (
        <Link
          href={catalogHref({ ...filter, page: page - 1 })}
          className="inline-flex min-h-control-sm items-center gap-2 rounded-control px-3 text-base font-semibold text-primary underline underline-offset-4"
        >
          <ArrowLeft aria-hidden className="size-5" />
          {p.prev}
        </Link>
      ) : (
        <span />
      )}
      <p className="text-base text-muted">{p.page(page, pageCount)}</p>
      {page < pageCount ? (
        <Link
          href={catalogHref({ ...filter, page: page + 1 })}
          className="inline-flex min-h-control-sm items-center gap-2 rounded-control px-3 text-base font-semibold text-primary underline underline-offset-4"
        >
          {p.next}
          <ArrowRight aria-hidden className="size-5" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
