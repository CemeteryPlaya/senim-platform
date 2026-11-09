import Link from "next/link";
import { Bath, ChevronRight, ClipboardList, CookingPot, DoorClosed, DoorOpen, Plus, Shirt, Sofa, type LucideIcon } from "lucide-react";
import { catalogHref, getCatalogFacets, listCatalog, PRICE_BUCKETS, type CatalogFilter, type PriceBucket } from "@/modules/companies";
import { listDeals, type DealListItem } from "@/modules/deal-core";
import { listMyRequests } from "@/modules/requests";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import {
  ButtonLink,
  CategoryTiles,
  Container,
  DealProgress,
  EmptyState,
  FilterChips,
  Money,
  RequestCard,
  SectionTitle,
  TrustNote,
  type CategoryTileItem,
} from "@/ui";
import { POPULAR_FURNITURE_TYPES } from "@/verticals/furniture";
import { WorkCard } from "../catalog/_components/WorkCard";
import { homeDealMoney } from "../deals/[id]/_parts/home-deal-money";
import { ACTIVE_DEAL } from "../deals/_parts/labels";
import { illustrationFor } from "./illustration";

const t = ru.common.home;
const c = t.client;

/** Плиток типов на главной (последняя — «Все типы», во всю ширину на телефоне): 2 + 2 + 1 на телефоне, 5 в ряд на десктопе. */
const TILES = 4;
/** Работ в ленте главной; остальное — «Все работы» в каталоге с тем же фильтром. */
const WORKS = 6;
/** Заявок на главной: остальные — «Все заявки». */
const REQUESTS = 2;

const TYPE_ICON: Record<string, LucideIcon> = {
  kitchen: CookingPot,
  wardrobe: DoorClosed,
  "walk-in-closet": Shirt,
  hallway: DoorOpen,
  bathroom: Bath,
};

/**
 * Главная заказчика (макет b-plus-a, экран 1): приветствие с одним главным действием «Оставить заявку» →
 * плитки типов мебели (в каталог) → «Моя сделка» с ходом сделки → живые заявки → плашка защиты денег →
 * чипы цены и лента работ из каталога. Работ нет — пустое состояние, и главное действие переходит в него.
 * Десктоп: «Моя сделка» и плашка — в ряд, карточки работ — в 3 колонки.
 */
export async function ClientHome({ user, price }: { user: CurrentUser; price: PriceBucket | undefined }) {
  const filter: CatalogFilter = { page: 1, ...(price ? { price } : {}) };
  const [requests, deals, catalog, facets] = await Promise.all([listMyRequests(user), listDeals(user), listCatalog(filter), getCatalogFacets()]);
  const active = deals.filter((d) => d.myRole === "CLIENT" && ACTIVE_DEAL.has(d.status));
  // Заявки, по которым уже идёт сделка, видны карточкой сделки; на главной — живые заявки и черновики.
  const open = requests.filter((r) => r.status !== "CLOSED" && r.status !== "CANCELLED");
  const works = catalog.items.slice(0, WORKS);
  const tiles: CategoryTileItem[] = POPULAR_FURNITURE_TYPES.flatMap((slug) => {
    const type = facets.types.find((f) => f.slug === slug);
    return type ? [{ href: catalogHref({ page: 1, type: slug }), label: type.name, icon: TYPE_ICON[slug] ?? Sofa }] : [];
  }).slice(0, TILES);
  const chips = [
    { href: "/", label: c.allPrices, active: !price },
    ...PRICE_BUCKETS.map((b) => ({ href: `/?price=${b}`, label: ru.companies.catalog.filters.prices[b], active: price === b })),
  ];

  return (
    <Container className="flex flex-col gap-6 pt-4 pb-10 sm:pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-extrabold break-words text-ink sm:text-3xl">{t.hello(user.fullName)}</h1>
        {/* Одно главное действие на экране: пока в ленте нет работ, оно — в пустом состоянии ниже. */}
        {works.length > 0 && (
          <ButtonLink href="/requests/new" icon={<Plus />} className="sm:shrink-0">
            {c.newRequest}
          </ButtonLink>
        )}
      </header>

      <nav aria-label={c.categoriesLabel}>
        <CategoryTiles items={tiles} moreHref="/catalog" moreLabel={c.allTypes} />
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        {active[0] && <MyDeal deal={active[0]} more={active.length - 1} />}
        {/* Плашка не тянется на высоту карточки сделки; без сделки — во всю ширину. */}
        <TrustNote className={active[0] ? "lg:self-start" : "lg:col-span-2"}>{c.trustNote}</TrustNote>
      </div>

      {open.length > 0 && (
        <section aria-labelledby="home-requests" className="flex flex-col gap-3">
          <SectionTitle id="home-requests" title={ru.common.nav.myRequests} action={{ href: "/requests", label: c.allRequests }} />
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
            {open.slice(0, REQUESTS).map((r) => {
              const draft = r.status === "DRAFT";
              return (
                <li key={r.id} className="flex">
                  <RequestCard
                    className="flex-1"
                    href={draft ? `/requests/new?draft=${r.id}` : `/requests/${r.id}`}
                    thumbUrl={r.cover?.src ?? illustrationFor(r.title)}
                    title={ru.requests.requestTitle(r.number, r.title)}
                    meta={[ru.requests.status[r.status], ...(draft ? [c.draft] : [])]}
                    isNew={false}
                    offersCount={r.offersCount}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="home-works" className="flex flex-col gap-4">
        <SectionTitle id="home-works" title={c.worksTitle} action={{ href: catalogHref(filter), label: c.allWorks }} />
        <FilterChips label={c.priceChips} items={chips} />
        {works.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title={c.worksEmptyTitle}
            titleAs="h3"
            description={c.worksEmptyText}
            action={
              <ButtonLink href="/requests/new" icon={<Plus />}>
                {c.worksEmptyAction}
              </ButtonLink>
            }
          />
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))]">
            {works.map((card) => (
              <li key={card.id}>
                <WorkCard card={card} compact />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  );
}

/**
 * «Моя сделка»: название (ссылка в саму сделку), статус, деньги и ход сделки. Деньги — только из журнала
 * (homeDealMoney); серый ход сделки при открытом споре — hasOpenDispute из deal-core (как на экране сделки). Сделок несколько —
 * рядом «Все сделки».
 */
function MyDeal({ deal, more }: { deal: DealListItem; more: number }) {
  const money = homeDealMoney(deal.money, deal.estimate);
  return (
    <section aria-labelledby="home-deal" className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <SectionTitle
        id="home-deal"
        as="h2"
        title={
          // Вид ссылки, как у остальных ссылок приложения: подчёркивание и стрелка; при наведении — зелёный.
          <Link
            href={`/deals/${deal.id}`}
            className="rounded-control text-ink underline decoration-line-strong underline-offset-4 hover:text-primary hover:decoration-primary"
          >
            {c.dealCard(deal.title)}
            <ChevronRight aria-hidden className="ml-1 inline-block size-5 align-middle text-primary" />
          </Link>
        }
        action={more > 0 ? { href: "/deals", label: c.allDeals } : undefined}
      />
      <p className="text-base text-ink-soft">
        {ru.deal.status[deal.status]} ·{" "}
        {money.amountTiyn !== null && (
          <>
            <Money amount={money.amountTiyn} className="font-semibold text-ink" />{" "}
          </>
        )}
        {money.label}
      </p>
      <DealProgress status={deal.status} hasOpenDispute={deal.hasOpenDispute} />
    </section>
  );
}
