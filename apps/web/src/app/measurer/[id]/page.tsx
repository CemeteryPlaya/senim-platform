import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { ru } from "@/i18n/ru";
import { isEnabled } from "@/platform/features";
import { requireUserPage } from "@/modules/identity";
import { getSiteMeasurement } from "@/modules/requests";
import { Alert, Container, DetailColumns, KeyValueList, PageHeader, formatDate } from "@/ui";
import { illustrationFor } from "@/app/_home/illustration";
import { orNotFound } from "@/app/requests/_parts/guard";
import { detailRows } from "@/app/requests/_parts/RequestFacts";
import { SiteMeasurementForm } from "./SiteMeasurementForm";

const t = ru.requests.pre.measurer;
const f = ru.requests.facts;
const x = ru.executor.measurer;

export const metadata: Metadata = { title: t.metaTitle };

type SiteMeasurement = Awaited<ReturnType<typeof getSiteMeasurement>>;

/** Иллюстрация вида мебели, адрес выезда и что в заявке (KeyValueList): правая колонка десктопа, верх экрана телефона. */
function RequestAside({ sm }: { sm: SiteMeasurement }) {
  const r = sm.request;
  const src = illustrationFor(r.title);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- иллюстрация вида мебели из public/img */}
      {src && <img src={src} alt="" className="aspect-[16/9] w-full rounded-card border border-line bg-sunken object-cover" />}
      {r.address && (
        <section aria-labelledby="visit" className="flex items-start gap-3 rounded-card bg-accent-soft p-4 sm:p-5">
          <MapPin aria-hidden className="mt-0.5 size-7 shrink-0 text-primary" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="visit" className="text-base font-bold text-ink">
              {x.visit}
            </h2>
            <p className="text-lg break-words text-ink">{r.address}</p>
          </div>
        </section>
      )}
      <section aria-labelledby="request-facts" className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 pt-4 pb-1 sm:px-5">
        <h2 id="request-facts" className="text-xl font-bold text-ink">
          {ru.requests.request.detailsTitle}
        </h2>
        <KeyValueList
          rows={[
            ...detailRows({ title: r.title, style: r.style, details: r.details }),
            { label: f.city, value: r.city },
            ...(r.desiredDate ? [{ label: f.desiredDate, value: formatDate(r.desiredDate) }] : []),
            ...(r.wishes ? [{ label: f.wishes, value: <span className="break-words whitespace-pre-line">{r.wishes}</span> }] : []),
          ]}
        />
      </section>
    </>
  );
}

/**
 * Замер площадки «B + A»: что в заявке и адрес выезда (KeyValueList) и форма результата; единственное действие шага —
 * «Отправить замер» в StickyAction. После отправки действия нет — только итог замера.
 */
export default async function SiteMeasurementPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled("preContractFlows")) notFound();
  const { id } = await params;
  const user = await requireUserPage(`/measurer/${id}`, "MEASURER");
  const sm = await orNotFound(getSiteMeasurement(user, id));
  const r = sm.request;
  const aside = <RequestAside sm={sm} />;
  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader back={{ href: "/measurer", label: t.title }} title={ru.requests.requestTitle(r.number, r.title)} className="pb-0" />
      {sm.status === "DONE" ? (
        <DetailColumns
          aside={aside}
          main={
            <section aria-labelledby="site-result" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
              <h2 id="site-result" className="text-xl font-bold text-ink">
                {t.formTitle}
              </h2>
              <Alert tone="success" title={t.doneTitle}>
                {t.doneText}
              </Alert>
              <KeyValueList
                rows={[
                  { label: ru.requests.pre.site.sizes, value: f.sizeValue(sm.widthCm ?? undefined, sm.heightCm ?? undefined, sm.depthCm ?? undefined) },
                  ...(sm.notes ? [{ label: t.notes, value: <span className="break-words whitespace-pre-line">{sm.notes}</span> }] : []),
                ]}
              />
            </section>
          }
        />
      ) : (
        <SiteMeasurementForm siteMeasurementId={sm.id} aside={aside} />
      )}
    </Container>
  );
}
