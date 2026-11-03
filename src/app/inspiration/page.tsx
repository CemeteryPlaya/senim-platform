import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, SearchX } from "lucide-react";
import { ru } from "@/i18n/ru";
import { getCatalogFacets, INSPIRATION_STEP, inspirationHref, listInspiration, parseInspirationFilter, type InspirationFilter, type SearchParams } from "@/modules/companies";
import { isEnabled } from "@/platform/features";
import { ButtonLink, Container, EmptyState, FilterChips, PageHeader, PhotoCard, StatusBadge, type FilterChip } from "@/ui";
import { STYLES, type StyleKey } from "@/verticals/furniture";

const t = ru.companies.inspiration;

export const metadata: Metadata = { title: t.title };

/**
 * «Вдохновение» (встреча 31.10, п. 2): лента фото работ — подборка Сенім первой, затем новые.
 * Доступна гостю и заказчику. Фильтры-чипы и «Показать ещё» — ссылки в адресе: работают без JavaScript.
 */
export default async function InspirationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // «Вдохновение» — Фаза 2 (флаг inspiration, ADR-009 раздел 8): выключено — страницы нет.
  if (!isEnabled("inspiration")) notFound();
  const filter = parseInspirationFilter(await searchParams);
  const [{ items, hasMore }, facets] = await Promise.all([listInspiration(filter), getCatalogFacets()]);
  // Сменили фильтр — снова первая порция.
  const chipHref = (patch: Partial<InspirationFilter>) => inspirationHref({ ...filter, ...patch, limit: INSPIRATION_STEP });
  const typeChips: FilterChip[] = [
    { key: "all", label: t.filters.all, href: chipHref({ type: undefined }) },
    ...facets.types.map((ft) => ({ key: ft.slug, label: ft.name, href: chipHref({ type: ft.slug }) })),
  ];
  const styleChips: FilterChip[] = [
    { key: "all", label: t.filters.all, href: chipHref({ style: undefined }) },
    ...(Object.entries(STYLES) as [StyleKey, (typeof STYLES)[StyleKey]][]).map(([key, s]) => ({ key, label: s.name, href: chipHref({ style: key }) })),
  ];

  return (
    <Container className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />

      <section aria-labelledby="inspiration-filters" className="flex flex-col gap-4">
        <h2 id="inspiration-filters" className="sr-only">
          {t.filters.label}
        </h2>
        {/* Подпись ряда видна глазами; для диктора её даёт aria-label навигации чипов. */}
        <div className="flex flex-col gap-2">
          <p aria-hidden className="text-base font-semibold text-ink">
            {t.filters.type}
          </p>
          <FilterChips label={t.filters.type} chips={typeChips} current={filter.type ?? "all"} />
        </div>
        <div className="flex flex-col gap-2">
          <p aria-hidden className="text-base font-semibold text-ink">
            {t.filters.style}
          </p>
          <FilterChips label={t.filters.style} chips={styleChips} current={filter.style ?? "all"} />
        </div>
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
              <PhotoCard
                key={tile.id}
                as="li"
                href={`/inspiration/${tile.id}`}
                image={tile.cover?.src ? { src: tile.cover.src } : null}
                title={tile.title}
                badge={tile.featured ? <StatusBadge tone="accent">{t.featured}</StatusBadge> : undefined}
                meta={[
                  { text: `${tile.furnitureType.name}, ${tile.style.name.toLowerCase()}` },
                  ...(tile.place ? [{ icon: <MapPin />, text: tile.place }] : []),
                  { text: tile.executorLabel },
                  ...(tile.doneOnPlatform ? [{ text: <StatusBadge tone="success">{t.doneOnPlatform}</StatusBadge> }] : []),
                ]}
                className="h-full"
              />
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
