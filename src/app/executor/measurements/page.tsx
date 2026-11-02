import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, MapPin, Ruler, Wallet } from "lucide-react";
import type { MeasurementStatus } from "@/generated/prisma/enums";
import { listAwaitingMeasurement, listMyMeasurements } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { isEnabled } from "@/platform/features";
import { Alert, ButtonLink, Container, DateText, EmptyState, FilterChips, Money, PageHeader, PhotoCard, SectionTitle, StatusBadge } from "@/ui";
import { pageUser } from "@/app/requests/_parts/guard";
import { MEASUREMENT_TONE } from "@/app/requests/_parts/labels";
import { NoAccess } from "@/app/_components/NoAccess";
import { photo } from "@/app/_home/illustration";

const t = ru.requests.measurements;
const x = ru.executor.measurements;

export const metadata: Metadata = { title: t.metaTitle };

const GROUPS = ["upcoming", "done", "other"] as const;
type Group = (typeof GROUPS)[number];
const GROUP: Record<MeasurementStatus, Group> = { SCHEDULED: "upcoming", DONE: "done", NO_DEAL: "other", CANCELLED: "other" };

/**
 * Замеры исполнителя по макету 15: кому назначить выезд, затем выезды чипами — предстоящие, выполненные,
 * без сделки. Действия (назначить, итоговая цена, «замер без сделки», проект) — на экране заявки.
 */
export default async function MeasurementsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  // Замер до оферты — только сценарии до договора (флаг preContractFlows, решение 2.2.9).
  if (!isEnabled("preContractFlows")) notFound();
  const sp = await searchParams;
  const user = await pageUser("EXECUTOR", "/executor/measurements");
  if (!user) {
    return <NoAccess description={ru.requests.noAccessExecutor} />;
  }
  const [awaiting, list] = await Promise.all([listAwaitingMeasurement(user), listMyMeasurements(user)]);
  const count = (g: Group) => list.filter((m) => GROUP[m.status] === g).length;
  // По умолчанию — первый непустой раздел: обычно это предстоящие выезды.
  const show: Group = GROUPS.find((g) => g === sp.show) ?? GROUPS.find((g) => count(g) > 0) ?? "upcoming";
  const shown = list.filter((m) => GROUP[m.status] === show);
  // Предстоящие — ближайший сверху; остальные — последние сверху (как отдаёт сервис).
  if (show === "upcoming") shown.reverse();

  return (
    <Container className="flex flex-col gap-8 pb-10">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />

      {awaiting.length > 0 && (
        <section aria-labelledby="awaiting" className="flex flex-col gap-4">
          <SectionTitle id="awaiting" title={t.awaitingTitle} />
          <Alert tone="accent">{t.awaitingText}</Alert>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            {awaiting.map((a) => {
              const title = ru.requests.requestTitle(a.number, a.title);
              return (
                <PhotoCard
                  key={a.offerId}
                  as="li"
                  layout="row"
                  image={photo(a.title)}
                  title={title}
                  meta={a.address ? [{ icon: <MapPin />, text: a.address }] : undefined}
                  footer={
                    <ButtonLink href={`/executor/requests/${a.requestId}`} aria-label={ru.common.ui.actionFor(ru.requests.executorRequest.schedule, title)}>
                      {ru.requests.executorRequest.schedule}
                    </ButtonLink>
                  }
                />
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="all-measurements" className="flex flex-col gap-4">
        <SectionTitle id="all-measurements" title={t.listTitle} />
        {list.length === 0 ? (
          <EmptyState icon={<Ruler />} title={t.emptyTitle} description={t.emptyText} titleAs="h3" />
        ) : (
          <>
            <FilterChips
              label={x.chipsLabel}
              current={show}
              chips={GROUPS.map((g) => ({ key: g, label: x.chips[g], count: count(g), href: `/executor/measurements?show=${g}` }))}
            />
            {shown.length === 0 ? (
              <p className="text-base text-muted">{x.emptyFilter}</p>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
                {shown.map((m) => (
                  <PhotoCard
                    key={m.id}
                    as="li"
                    layout="row"
                    href={`/executor/requests/${m.request.id}`}
                    image={photo(m.request.title)}
                    title={ru.requests.requestTitle(m.request.number, m.request.title)}
                    titleAs="h3"
                    badge={<StatusBadge tone={MEASUREMENT_TONE[m.status]}>{ru.requests.measurementStatus[m.status]}</StatusBadge>}
                    meta={[
                      { icon: <CalendarClock />, text: <DateText value={m.scheduledAt} format="dateTime" /> },
                      ...(m.request.address ? [{ icon: <MapPin />, text: m.request.address }] : []),
                      ...(m.feeAccrued !== null ? [{ icon: <Wallet />, text: <FeeText amount={m.feeAccrued} /> }] : []),
                    ]}
                    aside={m.finalPrice !== null ? <Money amount={m.finalPrice} /> : undefined}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </Container>
  );
}

function FeeText({ amount }: { amount: number }) {
  return (
    <>
      {t.fee}: <Money amount={amount} />
    </>
  );
}
