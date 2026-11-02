import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getDisputeCard } from "@/modules/operator";
import { isAppError } from "@/platform/errors";
import { ButtonLink, Card, Container, DateText, Fact, Money, PageHeader, StatusBadge, Timeline, type TimelineItem, type TimelineState } from "@/ui";
import { AuditList } from "../../_components/AuditList";
import { requireOperatorPage } from "../../_lib/guard";
import { ResolveForm } from "./ResolveForm";

const o = ru.operator;
const t = o.disputes;
const c = t.card;

export const metadata: Metadata = { title: t.title };

async function loadCard(user: Awaited<ReturnType<typeof requireOperatorPage>>, id: string) {
  try {
    return await getDisputeCard(user, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

type DisputeCard = Awaited<ReturnType<typeof loadCard>>;
type Stage = DisputeCard["deal"]["stages"][number];

const DONE: ReadonlySet<Stage["status"]> = new Set(["ACCEPTED", "CLOSED"]);
const ACTIVE: ReadonlySet<Stage["status"]> = new Set(["IN_PROGRESS", "SUBMITTED", "REWORK"]);

/** Этапы сделки как ход дела: принятые — пройдены, этап спора (или идущий, если спор не по этапу) — текущий. */
function stageSteps(d: DisputeCard): TimelineItem[] {
  const state = (s: Stage): TimelineState => {
    if (DONE.has(s.status)) return "done";
    if (d.stage ? d.stage.id === s.id : ACTIVE.has(s.status)) return "current";
    return "todo";
  };
  return d.deal.stages.map((s) => ({
    title: `${s.order}. ${s.title}`,
    description: (
      <span className="flex flex-wrap items-center gap-2">
        {s.payment ? `${o.stageStatus[s.status]}, ${o.paymentStatus[s.payment.status].toLowerCase()}` : o.stageStatus[s.status]}
        {d.stage?.id === s.id && <StatusBadge tone="danger">{c.stage}</StatusBadge>}
      </span>
    ),
    meta: <Money amount={s.amount} />,
    state: state(s),
  }));
}

function Position({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <p className={text ? "text-base break-words whitespace-pre-line text-ink-soft" : "text-base text-muted"}>{text ?? c.noPosition}</p>
    </div>
  );
}

export default async function DisputeCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOperatorPage(`/operator/disputes/${id}`);
  const d = await loadCard(user, id);
  const { deal } = d;

  return (
    <Container className="pb-10">
      <PageHeader
        title={c.title(deal.number)}
        description={deal.title}
        back={{ href: "/operator/disputes" }}
        actions={
          <ButtonLink href={`/deals/${deal.id}`} variant="secondary">
            {c.openDeal}
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={d.status === "OPEN" ? "danger" : "success"}>{t.status[d.status]}</StatusBadge>
              <StatusBadge tone="neutral">{t.reasons[d.reason]}</StatusBadge>
              <StatusBadge tone="info">{o.dealStatus[deal.status]}</StatusBadge>
            </div>
            <p className="text-base text-muted">
              {t.openedAt} <DateText value={d.createdAt} format="dateTime" />
            </p>
            <Position title={c.description} text={d.description} />
            <Position title={c.clientPosition} text={d.clientPosition} />
            <Position title={c.executorPosition} text={d.executorPosition} />
          </Card>

          {d.status === "OPEN" ? (
            <Card title={c.decisionTitle}>
              <ResolveForm disputeId={d.id} maxAmount={deal.totalAmount} />
            </Card>
          ) : (
            <Card title={c.resolvedBy}>
              <dl className="flex flex-col gap-4">
                <Fact label={c.decisionLabel}>{d.decision && t.decisions[d.decision]}</Fact>
                {d.decisionAmount !== null && (
                  <Fact label={c.decisionAmount}>
                    <Money amount={d.decisionAmount} />
                  </Fact>
                )}
                <Fact label={c.rationale}>
                  <span className="break-words whitespace-pre-line">{d.rationale}</span>
                </Fact>
                {d.resolvedAt && (
                  <Fact label={t.status.RESOLVED}>
                    <DateText value={d.resolvedAt} format="dateTime" /> {d.resolvedBy?.fullName}
                  </Fact>
                )}
              </dl>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:row-span-2">
          <Card title={c.parties}>
            <dl className="flex flex-col gap-4">
              <Fact label={c.client}>{deal.client.fullName}</Fact>
              <Fact label={c.executor}>
                <span className="break-words">
                  {ru.common.executorLabel(deal.executor.publicNumber)}: {deal.executor.legalName}
                </span>
              </Fact>
              <Fact label={c.amount}>
                <Money amount={deal.totalAmount} />
              </Fact>
              <Fact label={c.paymentMode}>{o.paymentModes[deal.paymentMode]}</Fact>
            </dl>
          </Card>

          <Card title={c.stages}>
            <Timeline label={c.stages} items={stageSteps(d)} />
          </Card>

          <Card title={c.attachments}>
            {d.attachments.length === 0 ? (
              <p className="text-base text-muted">{c.noAttachments}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.attachments.map((a) => (
                  <li key={a.id} className="text-sm break-all text-ink-soft">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                      {c.attachment(a.contentType, Math.ceil(a.size / 1024), a.sha256)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* История длинная: на телефоне — в самом конце, после сторон и этапов; на компьютере — под решением. */}
        <Card title={c.history} className="min-w-0 lg:col-start-1">
          <AuditList events={d.history} />
        </Card>
      </div>
    </Container>
  );
}
