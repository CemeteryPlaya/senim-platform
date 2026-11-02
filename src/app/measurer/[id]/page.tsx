import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { requireUserPage } from "@/modules/identity";
import { getSiteMeasurement } from "@/modules/requests";
import { Alert, Container, PageHeader, formatDate } from "@/ui";
import { orNotFound } from "@/app/requests/_parts/guard";
import { detailRows, FactList } from "@/app/requests/_parts/RequestFacts";
import { SiteMeasurementForm } from "./SiteMeasurementForm";

const t = ru.requests.pre.measurer;
const f = ru.requests.facts;

export const metadata: Metadata = { title: t.metaTitle };

/** Замер площадки: что в заявке, адрес выезда и форма результата (размеры, заметки, фото). */
export default async function SiteMeasurementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserPage(`/measurer/${id}`, "MEASURER");
  const sm = await orNotFound(getSiteMeasurement(user, id));
  const r = sm.request;
  return (
    <Container size="form" className="flex flex-col gap-6 pb-10">
      <PageHeader back={{ href: "/measurer", label: t.title }} title={ru.requests.requestTitle(r.number, r.title)} />
      <section aria-labelledby="request-facts" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
        <h2 id="request-facts" className="text-xl font-bold text-ink">
          {ru.requests.request.detailsTitle}
        </h2>
        <FactList
          rows={[
            ...detailRows({ title: r.title, style: r.style, details: r.details }),
            { label: f.city, value: r.city },
            ...(r.address ? [{ label: t.address, value: r.address }] : []),
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
