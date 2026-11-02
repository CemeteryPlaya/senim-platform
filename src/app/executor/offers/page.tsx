import type { Metadata } from "next";
import { CalendarClock, MapPin, Send } from "lucide-react";
import { listMyOffers, type MyOfferItem } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, EmptyState, FilterChips, Money, PageHeader, PhotoCard, StatusBadge, formatDateTime, formatRelative, type Tone } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { pageUser } from "@/app/requests/_parts/guard";
import { NoAccess } from "@/app/_components/NoAccess";
import { photo } from "@/app/_home/illustration";

const t = ru.executor.offers;

export const metadata: Metadata = { title: t.metaTitle };

const GROUPS = ["all", "waiting", "chosen", "closed"] as const;
type Group = (typeof GROUPS)[number];

const groupOf = (o: MyOfferItem): Exclude<Group, "all"> => (o.status === "SENT" ? "waiting" : o.status === "ACCEPTED" ? "chosen" : "closed");

/** Статус отклика простыми словами: у выбранного — где он сейчас (замер, договор). */
function status(o: MyOfferItem): { tone: Tone; text: string } {
  const s = t.status;
  switch (o.status) {
    case "SENT":
      return { tone: "warning", text: s.SENT };
    case "DECLINED":
      return { tone: "neutral", text: s.DECLINED };
    case "WITHDRAWN":
      return { tone: "neutral", text: s.WITHDRAWN };
    case "ACCEPTED":
      if (o.dealId) return { tone: "success", text: s.contract };
      if (o.measurement?.status === "SCHEDULED") return { tone: "accent", text: s.measuring };
      if (o.measurement?.status === "DONE") return { tone: "accent", text: s.measured };
      return { tone: "success", text: s.chosen };
  }
}

/** «Мои отклики» по макету 14: все отправленные предложения со статусами, фильтр чипами. */
export default async function MyOffersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const user = await pageUser("EXECUTOR", "/executor/offers");
  if (!user) return <NoAccess description={ru.requests.noAccessExecutor} />;

  const list = await listMyOffers(user);
  const show: Group = GROUPS.find((g) => g === sp.show) ?? "all";
  const shown = show === "all" ? list : list.filter((o) => groupOf(o) === show);

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} description={t.lead} back={{ href: "/executor/requests", label: ru.requests.incoming.title }} className="pb-0" />
      {list.length === 0 ? (
        <EmptyState
          icon={<Send />}
          title={t.emptyTitle}
          description={t.emptyText}
          action={<ButtonLink href="/executor/requests">{t.emptyAction}</ButtonLink>}
        />
      ) : (
        <>
          <FilterChips
            label={t.chipsLabel}
            current={show}
            chips={GROUPS.map((g) => ({
              key: g,
              label: t.chips[g],
              count: g === "all" ? list.length : list.filter((o) => groupOf(o) === g).length,
              href: g === "all" ? "/executor/offers" : `/executor/offers?show=${g}`,
            }))}
          />
          {shown.length === 0 ? (
            <p className="rounded-card border border-line bg-surface p-5 text-base text-ink-soft shadow-card">{t.emptyFilter}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
              {shown.map((o) => {
                const st = status(o);
                const measuring = o.measurement?.status === "SCHEDULED" && o.status === "ACCEPTED" && !o.dealId;
                return (
                  <PhotoCard
                    key={o.id}
                    as="li"
                    layout="row"
                    href={`/executor/requests/${o.requestId}`}
                    image={o.cover ?? photo(o.title)}
                    title={ru.requests.requestTitle(o.number, o.title)}
                    badge={<StatusBadge tone={st.tone}>{st.text}</StatusBadge>}
                    meta={[
                      { icon: <MapPin />, text: o.segment ? `${o.city} · ${SEGMENT_NAMES[o.segment]}` : o.city },
                      {
                        icon: <CalendarClock />,
                        text: measuring && o.measurement ? t.measurementAt(formatDateTime(o.measurement.scheduledAt)) : t.sent(formatRelative(o.createdAt)),
                      },
                    ]}
                    aside={<Money amount={o.measurement?.finalPrice ?? o.price} />}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}
    </Container>
  );
}
