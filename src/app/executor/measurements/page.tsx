import type { Metadata } from "next";
import { Ruler } from "lucide-react";
import { listAwaitingMeasurement, listMyMeasurements } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Alert, ButtonLink, Container, DateText, EmptyState, Money, PageHeader, StatusBadge } from "@/ui";
import { pageUser } from "@/app/requests/_parts/guard";
import { MEASUREMENT_TONE } from "@/app/requests/_parts/labels";

const t = ru.requests.measurements;

export const metadata: Metadata = { title: t.metaTitle };

/** Замеры исполнителя: кому назначить выезд, ближайшие выезды и итоговые цены. Действия — на экране заявки. */
export default async function MeasurementsPage() {
  const user = await pageUser("EXECUTOR", "/executor/measurements");
  if (!user) {
    return (
      <Container className="pt-6">
        <EmptyState title={ru.common.errors.forbidden} description={ru.requests.noAccessExecutor} />
      </Container>
    );
  }
  const [awaiting, list] = await Promise.all([listAwaitingMeasurement(user), listMyMeasurements(user)]);

  return (
    <Container className="flex flex-col gap-8 pb-10">
      <PageHeader title={t.title} description={t.lead} />

      {awaiting.length > 0 && (
        <section aria-labelledby="awaiting" className="flex flex-col gap-3">
          <h2 id="awaiting" className="text-xl font-bold text-ink">
            {t.awaitingTitle}
          </h2>
          <ul className="flex flex-col gap-3">
            {awaiting.map((a) => {
              const title = ru.requests.requestTitle(a.number, a.title);
              return (
                <li key={a.offerId}>
                  <Alert
                    tone="accent"
                    title={title}
                    action={
                      <ButtonLink href={`/executor/requests/${a.requestId}`}>
                        {ru.requests.executorRequest.schedule}
                        <span className="sr-only">: {title}</span>
                      </ButtonLink>
                    }
                  >
                    {a.address && <span className="block">{a.address}</span>}
                    {t.awaitingText}
                  </Alert>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="all-measurements" className="flex flex-col gap-3">
        <h2 id="all-measurements" className="text-xl font-bold text-ink">
          {t.listTitle}
        </h2>
        {list.length === 0 ? (
          <EmptyState icon={<Ruler />} title={t.emptyTitle} description={t.emptyText} titleAs="h3" />
        ) : (
          <ul className="flex flex-col gap-4">
            {list.map((m) => {
              const title = ru.requests.requestTitle(m.request.number, m.request.title);
              return (
                <li key={m.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-ink">{title}</h3>
                      <StatusBadge tone={MEASUREMENT_TONE[m.status]}>{ru.requests.measurementStatus[m.status]}</StatusBadge>
                    </div>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-base">
                      <dt className="text-muted">{t.when}</dt>
                      <dd className="text-ink">
                        <DateText value={m.scheduledAt} format="dateTime" />
                      </dd>
                      {m.request.address && (
                        <>
                          <dt className="text-muted">{ru.requests.facts.address}</dt>
                          <dd className="text-ink">{m.request.address}</dd>
                        </>
                      )}
                      {m.finalPrice !== null && (
                        <>
                          <dt className="text-muted">{t.finalPrice}</dt>
                          <dd className="font-semibold text-ink">
                            <Money amount={m.finalPrice} />
                          </dd>
                        </>
                      )}
                      {m.feeAccrued !== null && (
                        <>
                          <dt className="text-muted">{t.fee}</dt>
                          <dd className="text-ink">
                            <Money amount={m.feeAccrued} />
                          </dd>
                        </>
                      )}
                    </dl>
                  </div>
                  <ButtonLink href={`/executor/requests/${m.request.id}`} variant="secondary" className="shrink-0">
                    {t.open}
                    <span className="sr-only">: {title}</span>
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Container>
  );
}
