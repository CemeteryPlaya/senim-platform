import { CalendarClock, ClipboardList, Plus, UserRound } from "lucide-react";
import { listDeals } from "@/modules/deal-core";
import { listMyRequests } from "@/modules/requests";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, DateText, EmptyState, Money, PhotoCard, SectionTitle, StatusBadge } from "@/ui";
import { ACTIVE_DEAL, DEAL_TONE } from "../deals/_parts/labels";
import { REQUEST_TONE } from "../requests/_parts/labels";
import { photo } from "./illustration";

const t = ru.common.home;
const c = t.client;

/** Сколько карточек каждого вида на главной: остальное — по ссылке «Все…». */
const SHOWN = 3;

/**
 * Главная заказчика по макетам 7 и 10, минималистично: приветствие, одно главное действие «Оставить заявку»,
 * карточки текущих дел — заказы в работе (статус, сумма к оплате) и последние заявки (статус, отклики).
 */
export async function ClientHome({ user }: { user: CurrentUser }) {
  const [requests, deals] = await Promise.all([listMyRequests(user), listDeals(user)]);
  const active = deals.filter((d) => d.myRole === "CLIENT" && ACTIVE_DEAL.has(d.status));
  // Заявки, по которым уже идёт сделка, видны карточкой сделки; на главной — живые заявки и черновики.
  const open = requests.filter((r) => r.status !== "CLOSED" && r.status !== "CANCELLED");
  const nothing = active.length === 0 && open.length === 0;

  return (
    <Container className="flex flex-col gap-8 pt-4 pb-10 sm:pt-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{t.hello(user.fullName)}</h1>
        <ButtonLink href="/requests/new" icon={<Plus />} className="sm:shrink-0">
          {c.newRequest}
        </ButtonLink>
      </header>

      {nothing && <EmptyState icon={<ClipboardList />} title={c.emptyTitle} description={c.emptyText} />}

      {active.length > 0 && (
        <section aria-labelledby="home-deals" className="flex flex-col gap-4">
          <SectionTitle id="home-deals" title={c.dealsTitle} action={active.length > SHOWN ? { href: "/deals", label: c.allDeals } : undefined} />
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
            {active.slice(0, SHOWN).map((d) => (
              <PhotoCard
                as="li"
                key={d.id}
                layout="row"
                href={`/deals/${d.id}`}
                image={photo(d.title)}
                title={ru.deal.number(d.number)}
                badge={<StatusBadge tone={DEAL_TONE[d.status]}>{ru.deal.status[d.status]}</StatusBadge>}
                meta={[{ text: d.title }, { icon: <UserRound />, text: d.executorLabel }]}
                aside={<Money amount={d.estimate.totalTiyn} />}
              />
            ))}
          </ul>
        </section>
      )}

      {open.length > 0 && (
        <section aria-labelledby="home-requests" className="flex flex-col gap-4">
          <SectionTitle id="home-requests" title={c.requestsTitle} action={{ href: "/requests", label: c.allRequests }} />
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
            {open.slice(0, SHOWN).map((r) => {
              const draft = r.status === "DRAFT";
              return (
                <PhotoCard
                  as="li"
                  key={r.id}
                  layout="row"
                  href={draft ? `/requests/new?draft=${r.id}` : `/requests/${r.id}`}
                  image={photo(r.title)}
                  title={ru.requests.requestTitle(r.number, r.title)}
                  badge={<StatusBadge tone={REQUEST_TONE[r.status]}>{ru.requests.status[r.status]}</StatusBadge>}
                  meta={[
                    { text: draft ? c.draft : c.offers(r.offersCount) },
                    { icon: <CalendarClock />, text: <DateText value={r.publishedAt ?? r.createdAt} format="relative" /> },
                  ]}
                />
              );
            })}
          </ul>
        </section>
      )}

    </Container>
  );
}
