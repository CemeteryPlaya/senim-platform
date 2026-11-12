import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { listAwaitingSiteMeasurer, listRetryCandidates } from "@/modules/requests";
import { Alert, DateText, SectionTitle, StatusBadge } from "@/ui";
import { LIST_GRID, ListCard } from "../_components/ListCard";
import { AllowRetryForm, AssignMeasurerForm } from "./PreContractForms";

const t = ru.requests.pre.operator;

function Section({ id, title, lead, empty, children }: { id: string; title: string; lead: string; empty: string | null; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionTitle id={id} title={title} />
        <p className="max-w-prose text-base text-ink-soft">{lead}</p>
      </div>
      {empty ? <p className="text-base text-muted">{empty}</p> : children}
    </section>
  );
}

/** Сценарий 2: заявки ждут замерщика площадки — оператор назначает. */
export async function SiteMeasurerSection({ user }: { user: CurrentUser }) {
  const { requests, measurers } = await listAwaitingSiteMeasurer(user);
  return (
    <Section id="site-measure" title={t.siteTitle} lead={t.siteLead} empty={requests.length === 0 ? t.siteEmpty : null}>
      <ul className={LIST_GRID}>
        {requests.map((r) => (
          <ListCard
            key={r.id}
            title={t.request(r.number, r.title)}
            badges={r.measurer ? <StatusBadge tone="success">{t.assigned(r.measurer)}</StatusBadge> : undefined}
            meta={[
              <>
                {r.city}
                {r.publishedAt && (
                  <>
                    {", "}
                    <DateText value={r.publishedAt} format="dateTime" />
                  </>
                )}
              </>,
            ]}
          >
            {r.measurer ? null : measurers.length === 0 ? (
              <Alert tone="warning">{t.noMeasurers}</Alert>
            ) : (
              <AssignMeasurerForm requestId={r.id} measurers={measurers} />
            )}
          </ListCard>
        ))}
      </ul>
    </Section>
  );
}

/** №16: отклонённые исполнители открытых заявок — оператор может разрешить повторный отклик. */
export async function OfferRetrySection({ user }: { user: CurrentUser }) {
  const rows = await listRetryCandidates(user);
  return (
    <Section id="offer-retry" title={t.retryTitle} lead={t.retryLead} empty={rows.length === 0 ? t.retryEmpty : null}>
      <ul className={LIST_GRID}>
        {rows.map((r) => (
          <ListCard
            key={r.offerId}
            title={t.request(r.requestNumber, r.requestTitle)}
            badges={r.afterNoDeal ? <StatusBadge tone="warning">{ru.requests.measurementStatus.NO_DEAL}</StatusBadge> : undefined}
            meta={[<span key="executor" className="font-semibold text-ink">{ru.common.executorLabel(r.executorNumber)}</span>]}
          >
            <AllowRetryForm requestId={r.requestId} executorId={r.executorId} />
          </ListCard>
        ))}
      </ul>
    </Section>
  );
}
