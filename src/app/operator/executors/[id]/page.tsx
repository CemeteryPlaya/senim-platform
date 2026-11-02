import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getExecutorCard } from "@/modules/operator";
import { isAppError } from "@/platform/errors";
import { Card, Container, DateText, Fact, PageHeader, SectionTitle, StatusBadge, Timeline, type TimelineItem } from "@/ui";
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

type ExecutorCard = Awaited<ReturnType<typeof loadCard>>;

/** Ход регистрации: подана → проверка → решение. Решение — подтверждён или отклонён, пока нет — ждёт. */
function progress(x: ExecutorCard): TimelineItem[] {
  const pending = x.status === "PENDING";
  return [
    { title: c.progressSubmitted, meta: <DateText value={x.createdAt} />, state: "done" },
    { title: c.progressReview, meta: pending ? c.inReview : undefined, state: pending ? "current" : "done" },
    { title: pending ? c.progressDecision : t.registration[x.status], state: pending ? "todo" : "done" },
  ];
}

export default async function ExecutorCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOperatorPage(`/operator/executors/${id}`);
  const x = await loadCard(user, id);

  return (
    <Container className="pb-10">
      <PageHeader
        title={`${ru.common.executorLabel(x.publicNumber)}: ${x.legalName}`}
        description={`${t.legalForms[x.legalForm]}, ${x.city}`}
        back={{ href: "/operator/executors" }}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title={c.details}>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={x.status === "APPROVED" ? "success" : x.status === "PENDING" ? "warning" : "danger"}>{t.registration[x.status]}</StatusBadge>
              <StatusBadge tone={x.segment ? "accent" : "neutral"}>{x.segment ? t.segments[x.segment] : t.noSegment}</StatusBadge>
              {x.addedByOperator && <StatusBadge tone="info">{c.addedByOperator}</StatusBadge>}
            </div>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
              <Fact label={c.binIin}>{c.masked(x.binIinLast4)}</Fact>
              <Fact label={c.phone}>{c.masked(x.phoneLast4)}</Fact>
              <Fact label={c.experience}>{c.years(x.yearsExperience)}</Fact>
              <Fact label={t.executors.registered}>
                <DateText value={x.createdAt} />
              </Fact>
              <Fact label={t.executors.specializations}>{x.specializations.map((s) => s.name).join(", ") || t.none}</Fact>
              <Fact label={c.address}>
                <span className="break-words">{[x.city, x.district, x.streetAddress].filter(Boolean).join(", ")}</span>
              </Fact>
            </dl>
            <dl className="flex flex-col gap-4">
              {x.rejectReason && (
                <Fact label={c.rejectReason}>
                  <span className="break-words whitespace-pre-line">{x.rejectReason}</span>
                </Fact>
              )}
              <Fact label={t.executors.about}>
                <span className="break-words whitespace-pre-line">{x.about || t.none}</span>
              </Fact>
            </dl>
          </Card>

          {x.status === "PENDING" && (
            <section aria-labelledby="review" className="flex flex-col gap-4">
              <SectionTitle id="review" title={c.reviewTitle} />
              <ReviewForms profileId={x.id} />
            </section>
          )}
          {x.status === "APPROVED" && x.segment && <SegmentForm profileId={x.id} current={x.segment} />}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title={c.progress}>
            <Timeline label={c.progress} items={progress(x)} />
          </Card>
          <Card title={c.history}>{x.history.length === 0 ? <p className="text-base text-muted">{c.historyEmpty}</p> : <AuditList events={x.history} />}</Card>
        </div>
      </div>
    </Container>
  );
}
