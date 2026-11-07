import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listStaleRequests, staleRequestsSchema } from "@/modules/operator";
import { Container, DateText, EmptyState, FilterChips, PageHeader, StatusBadge, type FilterChip } from "@/ui";
import { LIST_GRID, ListCard } from "../_components/ListCard";
import { isEnabled } from "@/platform/features";
import { flatParams, requireOperatorPage } from "../_lib/guard";
import { OfferRetrySection, SiteMeasurerSection } from "./PreContractSections";

const t = ru.operator.requests;

export const metadata: Metadata = { title: t.title };

/** Чипы «Дольше суток · 3 суток · недели · месяца»; значение не из списка (из адреса) — своим чипом. */
function hoursChips(current: number): FilterChip[] {
  const presets = Object.entries(t.hoursPresets).map(([h, label]) => ({ key: h, label, href: `/operator/requests?hours=${h}` }));
  return presets.some((p) => p.key === String(current))
    ? presets
    : [...presets, { key: String(current), label: t.hoursCustom(current), href: `/operator/requests?hours=${current}` }];
}

export default async function StaleRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage("/operator/requests");
  const parsed = staleRequestsSchema.safeParse(flatParams(await searchParams));
  const { hours } = parsed.success ? parsed.data : { hours: 24 };
  const rows = await listStaleRequests(user, { hours });

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <FilterChips label={t.hoursFilter} current={String(hours)} chips={hoursChips(hours)} />
          {rows.length === 0 ? (
            <EmptyState icon={<Inbox />} title={t.empty} description={t.emptyHint} />
          ) : (
            <ul className={LIST_GRID}>
              {rows.map((r) => (
                <ListCard
                  key={r.id}
                  titleAs="h2"
                  title={t.request(r.number)}
                  badges={
                    <>
                      <StatusBadge tone="warning">
                        {t.waiting} {t.hours(r.waitingHours)}
                      </StatusBadge>
                      <StatusBadge tone="neutral">{t.mode[r.mode]}</StatusBadge>
                      {r.segment && <StatusBadge tone="accent">{ru.operator.segments[r.segment]}</StatusBadge>}
                    </>
                  }
                  meta={[
                    <span key="type" className="text-ink-soft">
                      {r.furnitureType?.name ?? r.customType}
                    </span>,
                    <>
                      {t.client}: {r.client.fullName}{" "}
                      <a href={`tel:${r.client.phone}`} className="inline-flex min-h-control-sm items-center text-primary underline">
                        {r.client.phone}
                      </a>
                    </>,
                    <>
                      {t.published} <DateText value={r.publishedAt} format="dateTime" />
                    </>,
                    r.declinedOffers > 0 ? t.declinedBefore(r.declinedOffers) : null,
                  ]}
                />
              ))}
            </ul>
          )}
        </div>
        {/* Сценарии до оферты (замерщик площадки, повтор отклика) — Фаза 2, флаг preContractFlows (ADR-009). */}
        {isEnabled("preContractFlows") && (
          <>
            <SiteMeasurerSection user={user} />
            <OfferRetrySection user={user} />
          </>
        )}
      </div>
    </Container>
  );
}
