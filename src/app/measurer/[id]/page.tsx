import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { requireUserPage } from "@/modules/identity";
import { getSiteMeasurement } from "@/modules/requests";
import { MapPin } from "lucide-react";
import { Alert, Container, PageHeader, formatDate } from "@/ui";
import { illustrationFor } from "@/app/_home/illustration";
import { orNotFound } from "@/app/requests/_parts/guard";
import { detailRows, FactList } from "@/app/requests/_parts/RequestFacts";
import { SiteMeasurementForm } from "./SiteMeasurementForm";

const t = ru.requests.pre.measurer;
const f = ru.requests.facts;
const x = ru.executor.measurer;

export const metadata: Metadata = { title: t.metaTitle };

/** Замер площадки: что в заявке, адрес выезда и форма результата (размеры, заметки, фото). */
export default async function SiteMeasurementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserPage(`/measurer/${id}`, "MEASURER");
  const sm = await orNotFound(getSiteMeasurement(user, id));
  const r = sm.request;
  return (
    <Container size="form" className="flex flex-col gap-6 pb-10">
      <PageHeader back={{ href: "/measurer", label: t.title }} title={ru.requests.requestTitle(r.number, r.title)} className="pb-0" />
      {(() => {
        const src = illustrationFor(r.title);
        // eslint-disable-next-line @next/next/no-img-element -- иллюстрация вида мебели из public/img
        return src ? <img src={src} alt="" className="aspect-[16/9] w-full rounded-card border border-line bg-sunken object-cover" /> : null;
      })()}
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
      <section aria-labelledby="request-facts" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
        <h2 id="request-facts" className="text-xl font-bold text-ink">
          {ru.requests.request.detailsTitle}
        </h2>
        <FactList
          rows={[
            ...detailRows({ title: r.title, style: r.style, details: r.details }),
            { label: f.city, value: r.city },
            ...(r.desiredDate ? [{ label: f.desiredDate, value: formatDate(r.desiredDate) }] : []),
            ...(r.wishes ? [{ label: f.wishes, value: r.wishes }] : []),
          ]}
        />
      </section>
      <section aria-labelledby="site-result" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
        <h2 id="site-result" className="text-xl font-bold text-ink">
          {t.formTitle}
        </h2>
        {sm.status === "DONE" ? (
          <>
            <Alert tone="success" title={t.doneTitle}>
              {t.doneText}
            </Alert>
            <FactList
              rows={[
                { label: ru.requests.pre.site.sizes, value: f.sizeValue(sm.widthCm ?? undefined, sm.heightCm ?? undefined, sm.depthCm ?? undefined) },
                ...(sm.notes ? [{ label: t.notes, value: sm.notes }] : []),
              ]}
            />
          </>
        ) : (
          <SiteMeasurementForm siteMeasurementId={sm.id} />
        )}
      </section>
    </Container>
  );
}
