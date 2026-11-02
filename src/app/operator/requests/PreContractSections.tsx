import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { listAwaitingSiteMeasurer, listRetryCandidates } from "@/modules/requests";
import { Alert, DateText, StatusBadge } from "@/ui";
import { AllowRetryForm, AssignMeasurerForm } from "./PreContractForms";

const t = ru.requests.pre.operator;

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-8 flex flex-col gap-3">
      <h2 id={id} className="text-xl font-bold text-ink">
        {title}
      </h2>
      <p className="text-base text-ink-soft">{lead}</p>
      {children}
    </section>
  );
}

/** Сценарий 2: заявки ждут замерщика площадки — оператор назначает. */
export async function SiteMeasurerSection({ user }: { user: CurrentUser }) {
  const { requests, measurers } = await listAwaitingSiteMeasurer(user);
  return (
    <Section id="site-measure" title={t.siteTitle} lead={t.siteLead}>
      {requests.length === 0 ? (
        <p className="text-base text-muted">{t.siteEmpty}</p>
      ) : (
        <ul className="rounded-card border border-line bg-surface px-5">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 border-b border-line py-4 last:border-b-0">
              <h3 className="text-lg font-bold text-ink">{t.request(r.number, r.title)}</h3>
              <p className="text-sm text-muted">
                {r.city}
                {r.publishedAt && (
                  <>
                    {", "}
                    <DateText value={r.publishedAt} format="dateTime" />
                  </>
                )}
              </p>
              {r.measurer ? (
                <StatusBadge tone="success">{t.assigned(r.measurer)}</StatusBadge>
              ) : measurers.length === 0 ? (
                <Alert tone="warning">{t.noMeasurers}</Alert>
              ) : (
                <AssignMeasurerForm requestId={r.id} measurers={measurers} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** №16: отклонённые исполнители открытых заявок — оператор может разрешить повторный отклик. */
export async function OfferRetrySection({ user }: { user: CurrentUser }) {
  const rows = await listRetryCandidates(user);
  return (
    <Section id="offer-retry" title={t.retryTitle} lead={t.retryLead}>
      {rows.length === 0 ? (
        <p className="text-base text-muted">{t.retryEmpty}</p>
      ) : (
        <ul className="rounded-card border border-line bg-surface px-5">
          {rows.map((r) => (
            <li key={r.offerId} className="flex flex-col gap-3 border-b border-line py-4 last:border-b-0">
              <h3 className="text-lg font-bold text-ink">{t.request(r.requestNumber, r.requestTitle)}</h3>
              <p className="flex flex-wrap items-center gap-2 text-base text-ink">
                {ru.common.executorLabel(r.executorNumber)}
                {r.afterNoDeal && <StatusBadge tone="warning">{ru.requests.measurementStatus.NO_DEAL}</StatusBadge>}
              </p>
              <AllowRetryForm requestId={r.requestId} executorId={r.executorId} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
