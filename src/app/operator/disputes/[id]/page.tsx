import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getDisputeCard } from "@/modules/operator";
import { isAppError } from "@/platform/errors";
import { ButtonLink, Card, Container, DateText, Money, PageHeader, StatusBadge } from "@/ui";
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

function Position({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <p className={text ? "break-words whitespace-pre-line text-ink-soft" : "text-muted"}>{text ?? c.noPosition}</p>
    </div>
  );
}

export default async function DisputeCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOperatorPage(`/operator/disputes/${id}`);
  const d = await loadCard(user, id);
  const { deal } = d;

  return (
    <Container>
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={d.status === "OPEN" ? "danger" : "success"}>{t.status[d.status]}</StatusBadge>
              <StatusBadge tone="neutral">{t.reasons[d.reason]}</StatusBadge>
              <StatusBadge tone="info">{o.dealStatus[deal.status]}</StatusBadge>
            </div>
            <p className="text-sm text-muted">
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
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="text-muted">{c.decisionLabel}</dt>
                <dd>{d.decision && t.decisions[d.decision]}</dd>
                {d.decisionAmount !== null && (
                  <>
                    <dt className="text-muted">{c.decisionAmount}</dt>
                    <dd>
                      <Money amount={d.decisionAmount} />
                    </dd>
                  </>
                )}
                <dt className="text-muted">{c.rationale}</dt>
                <dd className="break-words whitespace-pre-line">{d.rationale}</dd>
                {d.resolvedAt && (
                  <>
                    <dt className="text-muted">{t.status.RESOLVED}</dt>
                    <dd>
                      <DateText value={d.resolvedAt} format="dateTime" /> {d.resolvedBy?.fullName}
                    </dd>
                  </>
                )}
              </dl>
            </Card>
          )}

          <Card title={c.history}>
            <AuditList events={d.history} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title={c.parties}>
            <dl className="grid grid-cols-1 gap-y-2">
              <dt className="text-muted">{c.client}</dt>
              <dd>{deal.client.fullName}</dd>
              <dt className="text-muted">{c.executor}</dt>
              <dd className="break-words">
                {ru.common.executorLabel(deal.executor.publicNumber)}: {deal.executor.legalName}
              </dd>
              <dt className="text-muted">{c.amount}</dt>
              <dd>
                <Money amount={deal.totalAmount} />
              </dd>
              <dt className="text-muted">{c.paymentMode}</dt>
              <dd>{o.paymentModes[deal.paymentMode]}</dd>
            </dl>
          </Card>

          <Card title={c.stages}>
            <ol className="flex flex-col">
              {deal.stages.map((s) => (
                <li key={s.id} className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
                  <span className="font-semibold text-ink">
                    {s.order}. {s.title}
                    {d.stage?.id === s.id && (
                      <>
                        {" "}
                        <StatusBadge tone="danger">{c.stage}</StatusBadge>
                      </>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-2 text-sm text-ink-soft">
                    <Money amount={s.amount} />
                    <StatusBadge tone="neutral">{o.stageStatus[s.status]}</StatusBadge>
                    {s.payment && <StatusBadge tone="neutral">{o.paymentStatus[s.payment.status]}</StatusBadge>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <Card title={c.attachments}>
            {d.attachments.length === 0 ? (
              <p className="text-muted">{c.noAttachments}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.attachments.map((a) => (
                  <li key={a.id} className="text-sm break-all text-ink-soft">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                      {c.attachment(a.contentType, Math.ceil(a.size / 1024), a.sha256)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Container>
  );
}
