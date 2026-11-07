import { CalendarClock, Images, Inbox, MapPin, Package, Ruler, Send, Store, Wallet } from "lucide-react";
import { listDeals } from "@/modules/deal-core";
import { listIncomingRequests } from "@/modules/requests";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { Container, DateText, LinkList, Money, PhotoCard, SectionTitle, Stat, StatusBadge } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { ACTIVE_DEAL } from "../deals/_parts/labels";
import { photo } from "./illustration";

const t = ru.common.home;
const e = t.executor;
const nav = ru.common.nav;

const SHOWN = 3;

/**
 * Главная исполнителя по макету 12 («Кабинет производителя»), минималистично: приветствие, сумма заказов в работе
 * (настоящее число), список разделов с числами и главным пунктом «Новые заявки», карточки новых заявок с фото.
 */
export async function ExecutorHome({ user }: { user: CurrentUser }) {
  const [incoming, deals] = await Promise.all([listIncomingRequests(user), listDeals(user)]);
  const fresh = incoming.filter((r) => r.myOfferStatus === null);
  const active = deals.filter((d) => d.myRole === "EXECUTOR" && ACTIVE_DEAL.has(d.status));
  // Мастеру своя смета — к выплате (цена минус гарантия оплаты 4%).
  const inWork = active.reduce((sum, d) => sum + d.estimate.totalTiyn, 0n);

  return (
    <Container className="flex flex-col gap-8 pt-4 pb-10 sm:pt-8">
      <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{t.hello(user.fullName)}</h1>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Числа новых заявок и заказов — справа в строках списка; отдельной плиткой — только сумма. */}
          <Stat icon={<Wallet />} value={<Money amount={inWork} />} label={e.inWork} />
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
            <p className="text-base text-muted">{e.noRequests}</p>
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
