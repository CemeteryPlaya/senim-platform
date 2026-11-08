import type { Metadata } from "next";
import { Send } from "lucide-react";
import { listMyOffers, wholeKzt, type MyOfferItem } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, EmptyState, FilterChips, PageHeader, RequestCard, StatusBadge, formatDateTime, formatMoney, formatRelative, type Tone } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { pageUser } from "@/app/requests/_parts/guard";
import { NoAccess } from "@/app/_components/NoAccess";
import { illustrationFor } from "@/app/_home/illustration";

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

/** «Мои отклики» (макет 14 в стиле «B + A»): все отправленные предложения карточками заявок со статусом и ценой, фильтр чипами. */
export default async function MyOffersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const user = await pageUser("EXECUTOR", "/executor/offers");
  if (!user) return <NoAccess description={ru.requests.noAccessExecutor} />;

  const list = await listMyOffers(user);
  const show: Group = GROUPS.find((g) => g === sp.show) ?? "all";
  const shown = show === "all" ? list : list.filter((o) => groupOf(o) === show);

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} back={{ href: "/executor/requests", label: ru.requests.incoming.title }} className="pb-0" />
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
            items={GROUPS.map((g) => ({
              label: ru.common.ui.filterChip(t.chips[g], g === "all" ? list.length : list.filter((o) => groupOf(o) === g).length),
              href: g === "all" ? "/executor/offers" : `/executor/offers?show=${g}`,
              active: g === show,
            }))}
          />
          {shown.length === 0 ? (
            <p className="text-base text-muted">{t.emptyFilter}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
              {shown.map((o) => {
                const st = status(o);
                const measuring = o.measurement?.status === "SCHEDULED" && o.status === "ACCEPTED" && !o.dealId;
                const price = o.measurement?.finalPrice ?? wholeKzt(o.priceTiyn);
                return (
                  <li key={o.id} className="flex">
                    <RequestCard
                      className="flex-1"
                      href={`/executor/requests/${o.requestId}`}
                      thumbUrl={o.cover?.src ?? illustrationFor(o.title)}
                      title={ru.requests.requestTitle(o.number, o.title)}
                      isNew={false}
                      badges={<StatusBadge tone={st.tone}>{st.text}</StatusBadge>}
                      meta={[
                        formatMoney(price),
                        o.segment ? `${o.city} · ${SEGMENT_NAMES[o.segment]}` : o.city,
                        measuring && o.measurement ? t.measurementAt(formatDateTime(o.measurement.scheduledAt)) : t.sent(formatRelative(o.createdAt)),
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Container>
  );
}
