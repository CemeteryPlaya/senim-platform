import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Chips, EmptyState, PageTitle, Pagination, Stack, WorkCard } from "@/kit";
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

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      {view.showFilters && (
        <Stack>
          <Chips label={t.typeLabel} items={view.typeChips} />
          <Chips label={t.priceLabel} items={view.priceChips} />
          {view.found && <p className="text-sub text-muted">{view.found}</p>}
        </Stack>
      )}
      {view.empty && <EmptyState title={view.empty.title} body={view.empty.body} action={view.empty.action} />}
      {view.cards.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 desktop:grid-cols-3 desktop:gap-4">
          {view.cards.map((card) => (
            <li key={card.id} className="grid">
              <WorkCard href={card.href} title={card.title} meta={card.meta} priceFrom={card.priceFrom} photo={card.photo} />
            </li>
          ))}
        </ul>
      )}
      {view.state === "results" && <Pagination page={view.page} pageCount={view.pageCount} hrefFor={view.hrefFor} label={t.paginationLabel} />}
    </Stack>
  );
}
