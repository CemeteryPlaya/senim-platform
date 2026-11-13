import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Chips, Columns, EmptyState, FilterList, PageTitle, Pagination, Sidebar, Stack, TextLink, WorkCard } from "@/kit";
import { getDevice } from "@/platform/device";
import { getCatalogFacets, listCatalog, parseCatalogFilter, type SearchParams } from "@/modules/companies";
import { catalogView } from "./_parts/catalog-view";

const t = ru.app.guest.catalog;

export const metadata: Metadata = { title: t.title };

/**
 * Каталог работ: тип мебели и цена — чипами-ссылками (всё в адресе), карточки ведут на публичный профиль мастера.
 * Открыт гостю. Главного действия при результатах нет; в пустых состояниях оно одно — в `EmptyState`.
 */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filter = parseCatalogFilter(await searchParams);
  const [result, facets] = await Promise.all([listCatalog(filter), getCatalogFacets()]);
  const view = catalogView(result, facets, filter);
  const device = await getDevice();

  const results = (
    <Stack gap="section">
      {view.empty && <EmptyState title={view.empty.title} body={view.empty.body} action={view.empty.action} />}
      {view.cards.length > 0 && (
        <Columns count={3}>
          {view.cards.map((card) => (
            <WorkCard
              key={card.id}
              href={card.href}
              title={card.title}
              meta={card.meta}
              byline={card.byline}
              priceFrom={card.priceFrom}
              media={view.media}
              photo={card.photo}
              headingLevel={2}
            />
          ))}
        </Columns>
      )}
      {view.similarLink && <TextLink href={view.similarLink.href}>{view.similarLink.label}</TextLink>}
      {view.state === "results" && <Pagination page={view.page} pageCount={view.pageCount} hrefFor={view.hrefFor} label={t.paginationLabel} />}
    </Stack>
  );

  // Один набор фильтров: на компьютере списки слева, на телефоне две ленты чипов; версию выбирает сервер.
  const found = view.found && <p className="text-sub text-muted">{view.found}</p>;
  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      {!view.showFilters ? (
        results
      ) : device === "desktop" ? (
        <Sidebar
          device={device}
          aside={
            <Stack gap="section">
              <FilterList title={t.typeLabel} items={view.typeChips} />
              <FilterList title={t.priceLabel} items={view.priceChips} />
            </Stack>
          }
        >
          <Stack gap="section">
            {found}
            {results}
          </Stack>
        </Sidebar>
      ) : (
        <>
          <Stack>
            <Chips label={t.typeLabel} items={view.typeChips} />
            <Chips label={t.priceLabel} items={view.priceChips} />
            {found}
          </Stack>
          {results}
        </>
      )}
    </Stack>
  );
}
