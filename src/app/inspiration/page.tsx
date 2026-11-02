import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { ru } from "@/i18n/ru";
import { getCatalogFacets, INSPIRATION_STEP, inspirationHref, listInspiration, parseInspirationFilter, type InspirationFilter, type SearchParams } from "@/modules/companies";
import { ButtonLink, Container, EmptyState, PageHeader } from "@/ui";
import { STYLES, type StyleKey } from "@/verticals/furniture";
import { FilterChips, type Chip } from "./_parts/FilterChips";
import { InspirationTile } from "./_parts/InspirationTile";

const t = ru.companies.inspiration;

export const metadata: Metadata = { title: t.title };

/**
 * «Вдохновение» (встреча 31.10, п. 2): лента фото работ — подборка Сенім первой, затем новые.
 * Доступна гостю и заказчику. Фильтры-чипы и «Показать ещё» — ссылки в адресе: работают без JavaScript.
 */
export default async function InspirationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filter = parseInspirationFilter(await searchParams);
  const [{ items, hasMore }, facets] = await Promise.all([listInspiration(filter), getCatalogFacets()]);
  // Сменили фильтр — снова первая порция.
  const chipHref = (patch: Partial<InspirationFilter>) => inspirationHref({ ...filter, ...patch, limit: INSPIRATION_STEP });
  const typeChips: Chip[] = [
    { key: "all", label: t.filters.all, href: chipHref({ type: undefined }), selected: !filter.type },
    ...facets.types.map((ft) => ({ key: ft.slug, label: ft.name, href: chipHref({ type: ft.slug }), selected: filter.type === ft.slug })),
  ];
  const styleChips: Chip[] = [
    { key: "all", label: t.filters.all, href: chipHref({ style: undefined }), selected: !filter.style },
    ...(Object.entries(STYLES) as [StyleKey, (typeof STYLES)[StyleKey]][]).map(([key, s]) => ({
      key,
      label: s.name,
      href: chipHref({ style: key }),
      selected: filter.style === key,
    })),
  ];

  return (
    <Container className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} description={t.description} back={{ href: "/" }} className="pb-0" />

      <section aria-labelledby="inspiration-filters" className="flex flex-col gap-4">
        <h2 id="inspiration-filters" className="sr-only">
          {t.filters.label}
        </h2>
        <FilterChips id="filter-type" label={t.filters.type} chips={typeChips} />
        <FilterChips id="filter-style" label={t.filters.style} chips={styleChips} />
      </section>

      {items.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={t.empty.title}
          description={t.empty.text}
          action={
            <div className="flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/requests/new">{t.empty.action}</ButtonLink>
              <ButtonLink href="/inspiration" variant="ghost">
                {t.filters.reset}
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <section aria-labelledby="inspiration-results" className="flex flex-col gap-4">
          <h2 id="inspiration-results" className="sr-only">
            {t.shownOf(items.length)}
          </h2>
          {/* Колонки от ширины в rem: при крупном шрифте их становится меньше, плитки не сжимаются. */}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(10rem,100%),1fr))] gap-3 sm:gap-4 lg:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
            {items.map((tile) => (
              <li key={tile.id} className="min-w-0">
                <InspirationTile tile={tile} />
              </li>
            ))}
          </ul>
          <p className="text-base text-muted" aria-live="polite">
            {t.shownOf(items.length)}
          </p>
          {hasMore && (
            <ButtonLink href={inspirationHref({ ...filter, limit: filter.limit + INSPIRATION_STEP })} scroll={false} variant="secondary" fullWidth>
              {t.more}
            </ButtonLink>
          )}
        </section>
      )}
    </Container>
  );
}
