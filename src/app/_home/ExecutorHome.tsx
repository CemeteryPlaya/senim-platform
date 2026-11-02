import { CalendarClock, Images, Inbox, MapPin, Package, Ruler, Send, Store, Wallet } from "lucide-react";
import type { DealStatus } from "@/generated/prisma/enums";
import { listDeals } from "@/modules/deal-core";
import { listIncomingRequests } from "@/modules/requests";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { Container, DateText, LinkList, Money, PhotoCard, SectionTitle, Stat, StatusBadge } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { photo } from "./illustration";

const t = ru.common.home;
const e = t.executor;
const nav = ru.common.nav;

/** Заказ в работе: договор подписывается, идут этапы или открыт спор. */
const ACTIVE_DEAL: ReadonlySet<DealStatus> = new Set(["AWAITING_SIGNATURES", "AWAITING_DEPOSIT", "IN_PROGRESS", "DISPUTE"]);
const SHOWN = 3;

/**
 * Главная исполнителя по макету 12 («Кабинет производителя»): приветствие, показатели (только настоящие
 * числа: новые заявки, заказы в работе, их сумма), список разделов с главным пунктом «Новые заявки»
 * и карточки новых заявок с фото.
 */
export async function ExecutorHome({ user }: { user: CurrentUser }) {
  const [incoming, deals] = await Promise.all([listIncomingRequests(user), listDeals(user)]);
  const fresh = incoming.filter((r) => r.myOfferStatus === null);
  const active = deals.filter((d) => d.myRole === "EXECUTOR" && ACTIVE_DEAL.has(d.status));
  const inWork = active.reduce((sum, d) => sum + d.totalAmount, 0);

  return (
    <Container className="flex flex-col gap-8 pt-4 pb-10 sm:pt-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{t.hello(user.fullName)}</h1>
        <p className="max-w-prose text-lg text-muted">{e.lead}</p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-3">
            <li className="flex">
              <Stat className="flex-1" icon={<Inbox />} value={fresh.length} label={e.newRequests} />
            </li>
            <li className="flex">
              <Stat className="flex-1" icon={<Package />} value={active.length} label={e.activeDeals} />
            </li>
            <li className="col-span-full flex">
              <Stat className="flex-1" icon={<Wallet />} value={<Money amount={inWork} />} label={e.inWork} />
            </li>
          </ul>
          <nav aria-label={e.sections}>
            <LinkList
              items={[
                { href: "/executor/requests", label: e.newRequests, icon: <Inbox />, meta: fresh.length, highlight: true },
                { href: "/executor/offers", label: ru.executor.offers.title, icon: <Send /> },
                { href: "/deals", label: nav.orders, icon: <Package />, meta: active.length },
                { href: "/executor/measurements", label: nav.measurements, icon: <Ruler /> },
                { href: "/executor/finance", label: nav.finance, icon: <Wallet /> },
                { href: "/executor/portfolio", label: nav.portfolio, icon: <Images /> },
                { href: "/executor/profile", label: nav.company, icon: <Store /> },
              ]}
            />
          </nav>
        </div>

        <section aria-labelledby="home-incoming" className="flex min-w-0 flex-col gap-4">
          <SectionTitle id="home-incoming" title={e.requestsTitle} action={{ href: "/executor/requests", label: e.allRequests }} />
          {fresh.length === 0 ? (
            <p className="rounded-card border border-line bg-surface p-5 text-base text-ink-soft shadow-card">{e.noRequests}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {fresh.slice(0, SHOWN).map((r) => (
                <PhotoCard
                  as="li"
                  key={r.id}
                  layout="row"
                  href={`/executor/requests/${r.id}`}
                  image={r.cover ?? photo(r.title)}
                  title={ru.requests.requestTitle(r.number, r.title)}
                  badge={r.segment ? <StatusBadge tone="info">{SEGMENT_NAMES[r.segment]}</StatusBadge> : undefined}
                  meta={[
                    ...(r.city ? [{ icon: <MapPin />, text: r.city }] : []),
                    ...(r.publishedAt ? [{ icon: <CalendarClock />, text: <DateText value={r.publishedAt} format="relative" /> }] : []),
                    { text: e.noOffer },
                  ]}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Container>
  );
}
