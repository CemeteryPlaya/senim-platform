import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { listStaleRequests, staleRequestsSchema } from "@/modules/operator";
import { Button, Container, DateText, EmptyState, Input, PageHeader, StatusBadge } from "@/ui";
import { flatParams, requireOperatorPage } from "../_lib/guard";

const t = ru.operator.requests;

export const metadata: Metadata = { title: t.title };

export default async function StaleRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage("/operator/requests");
  const parsed = staleRequestsSchema.safeParse(flatParams(await searchParams));
  const { hours } = parsed.success ? parsed.data : { hours: 24 };
  const rows = await listStaleRequests(user, { hours });

  return (
    <Container>
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      <form method="get" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input label={t.hoursLabel} name="hours" type="number" inputMode="numeric" min={1} max={720} defaultValue={hours} className="sm:w-48" />
        <Button type="submit" variant="secondary">
          {t.apply}
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={t.empty} description={t.emptyHint} />
      ) : (
        <ul className="rounded-card border border-line bg-surface px-5">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 border-b border-line py-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-ink">{t.request(r.number)}</h2>
                <StatusBadge tone="neutral">{t.mode[r.mode]}</StatusBadge>
                {r.segment && <StatusBadge tone="accent">{ru.operator.segments[r.segment]}</StatusBadge>}
                <StatusBadge tone="warning">
                  {t.waiting} {t.hours(r.waitingHours)}
                </StatusBadge>
              </div>
              <p className="text-base text-ink-soft">{r.furnitureType?.name ?? r.customType}</p>
              <p className="text-base text-ink-soft">
                {t.client}: {r.client.fullName}{" "}
                <a href={`tel:${r.client.phone}`} className="text-accent underline">
                  {r.client.phone}
                </a>
              </p>
              <p className="text-sm text-muted">
                {t.published} <DateText value={r.publishedAt} format="dateTime" />
                {r.declinedOffers > 0 && (
                  <>
                    <br />
                    {t.declinedBefore(r.declinedOffers)}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
