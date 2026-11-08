import type { Metadata } from "next";
import { CalendarClock, Inbox, MapPin, Send, Users } from "lucide-react";
import { listIncomingRequests, type IncomingListItem } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, DateText, EmptyState, LegacyFilterChips, PageHeader, PhotoCard, StatusBadge, type LegacyFilterChip } from "@/ui";
import { SEGMENT_NAMES, STYLES, type StyleKey } from "@/verticals/furniture";
import { pageUser } from "@/app/requests/_parts/guard";
import { OFFER_TONE } from "@/app/requests/_parts/labels";
import { NoAccess } from "@/app/_components/NoAccess";
import { photo } from "@/app/_home/illustration";

const t = ru.requests.incoming;
const x = ru.executor.incoming;

export const metadata: Metadata = { title: t.metaTitle };

type Search = { f?: string; type?: string };

/** Выбранный чип из адреса: раздел (без отклика, прямые) или тип мебели; неизвестное — «Все». */
function selected(sp: Search, list: readonly IncomingListItem[]): { key: string; keep: (r: IncomingListItem) => boolean } {
  if (sp.type && list.some((r) => r.title === sp.type)) return { key: `type:${sp.type}`, keep: (r) => r.title === sp.type };
  if (sp.f === "new") return { key: "new", keep: (r) => r.myOfferStatus === null };
  if (sp.f === "direct") return { key: "direct", keep: (r) => r.mode === "DIRECT" };
  return { key: "all", keep: () => true };
}

function chipsFor(list: readonly IncomingListItem[]): LegacyFilterChip[] {
  const base = "/executor/requests";
  const count = (keep: (r: IncomingListItem) => boolean) => list.filter(keep).length;
  const types = [...new Set(list.map((r) => r.title))];
  const direct = count((r) => r.mode === "DIRECT");
  return [
    { key: "all", label: x.chips.all, count: list.length, href: base },
    { key: "new", label: x.chips.new, count: count((r) => r.myOfferStatus === null), href: `${base}?f=new` },
    ...(direct > 0 ? [{ key: "direct", label: x.chips.direct, count: direct, href: `${base}?f=direct` }] : []),
    ...(types.length > 1
      ? types.map((type) => ({ key: `type:${type}`, label: type, count: count((r) => r.title === type), href: `${base}?type=${encodeURIComponent(type)}` }))
      : []),
  ];
}

/** Входящие исполнителя по макету 13: тендеры его уровня и прямые запросы к нему — карточки с фото. */
export default async function IncomingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await pageUser("EXECUTOR", "/executor/requests");
  if (!user) {
    return <NoAccess description={ru.requests.noAccessExecutor} />;
  }
  const list = await listIncomingRequests(user);
  const current = selected(sp, list);
  const shown = list.filter(current.keep);

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader
        title={t.title}
        back={{ href: "/" }}
        actions={
          <ButtonLink href="/executor/offers" variant="secondary" icon={<Send />}>
            {x.myOffers}
          </ButtonLink>
        }
        className="pb-0"
      />

      {list.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t.emptyTitle} description={t.emptyText} />
      ) : (
        <>
          <LegacyFilterChips label={x.chipsLabel} current={current.key} chips={chipsFor(list)} />
          {shown.length === 0 ? (
            <p className="text-base text-muted">{x.emptyFilter}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
              {shown.map((r) => (
                <IncomingCard key={r.id} r={r} />
              ))}
            </ul>
          )}
        </>
      )}
    </Container>
  );
}

function IncomingCard({ r }: { r: IncomingListItem }) {
  const style = r.style ? (STYLES[r.style as StyleKey]?.name ?? r.style) : null;
  return (
    <PhotoCard
      as="li"
      layout="row"
      href={`/executor/requests/${r.id}`}
      image={r.cover ?? photo(r.title)}
      title={ru.requests.requestTitle(r.number, r.title)}
      badge={
        <span className="flex flex-wrap gap-2">
          {r.segment && <StatusBadge tone="info">{SEGMENT_NAMES[r.segment]}</StatusBadge>}
          {r.mode === "DIRECT" && <StatusBadge tone="accent">{x.direct}</StatusBadge>}
        </span>
      }
      meta={[
        { icon: <MapPin />, text: style ? `${r.city} · ${style}` : r.city },
        ...(r.publishedAt ? [{ icon: <CalendarClock />, text: <DateText value={r.publishedAt} format="relative" /> }] : []),
        { icon: <Users />, text: x.offers(r.offersCount) },
      ]}
      aside={
        r.myOfferStatus ? (
          <StatusBadge tone={OFFER_TONE[r.myOfferStatus]}>{x.myOffer(ru.requests.offerStatus[r.myOfferStatus].toLowerCase())}</StatusBadge>
        ) : undefined
      }
    />
  );
}
