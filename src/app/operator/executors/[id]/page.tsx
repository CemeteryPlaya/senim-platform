import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getExecutorCard } from "@/modules/operator";
import { isAppError } from "@/platform/errors";
import { Card, Container, DateText, PageHeader, StatusBadge } from "@/ui";
import { AuditList } from "../../_components/AuditList";
import { requireOperatorPage } from "../../_lib/guard";
import { ReviewForms, SegmentForm } from "./ExecutorForms";

const t = ru.operator;
const c = t.executors.card;

export const metadata: Metadata = { title: t.executors.title };

async function loadCard(user: Awaited<ReturnType<typeof requireOperatorPage>>, id: string) {
  try {
    return await getExecutorCard(user, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

export default async function ExecutorCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOperatorPage();
  const x = await loadCard(user, (await params).id);

  return (
    <Container>
      <PageHeader
        title={`${ru.common.executorLabel(x.publicNumber)}: ${x.legalName}`}
        description={`${t.legalForms[x.legalForm]}, ${x.city}`}
        back={{ href: "/operator/executors" }}
      />
      <div className="flex flex-col gap-6">
        <Card>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={x.status === "APPROVED" ? "success" : x.status === "PENDING" ? "warning" : "danger"}>{t.registration[x.status]}</StatusBadge>
            <StatusBadge tone={x.segment ? "accent" : "neutral"}>{x.segment ? t.segments[x.segment] : t.noSegment}</StatusBadge>
            {x.addedByOperator && <StatusBadge tone="info">{c.addedByOperator}</StatusBadge>}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-muted">{t.executors.registered}</dt>
            <dd>
              <DateText value={x.createdAt} />
            </dd>
            <dt className="text-muted">{t.executors.specializations}</dt>
            <dd>{x.specializations.map((s) => s.name).join(", ") || t.none}</dd>
            <dt className="text-muted">{t.executors.about}</dt>
            <dd className="break-words">{x.about || t.none}</dd>
            {x.rejectReason && (
              <>
                <dt className="text-muted">{c.rejectReason}</dt>
                <dd className="break-words">{x.rejectReason}</dd>
              </>
            )}
          </dl>
          <p className="text-base text-ink-soft">
            {t.binIinMasked(x.binIinLast4)}
            <br />
            {t.phoneMasked(x.phoneLast4)}
            <br />
            {t.executors.experience(x.yearsExperience)}
          </p>
        </Card>

        {x.status === "PENDING" && (
          <section aria-labelledby="review" className="flex flex-col gap-3">
            <h2 id="review" className="text-xl font-bold text-ink">
              {c.reviewTitle}
            </h2>
            <ReviewForms profileId={x.id} />
          </section>
        )}
        {x.status === "APPROVED" && x.segment && <SegmentForm profileId={x.id} current={x.segment} />}

        <Card title={c.history}>{x.history.length === 0 ? <p className="text-muted">{c.historyEmpty}</p> : <AuditList events={x.history} />}</Card>
      </div>
    </Container>
  );
}
