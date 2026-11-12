import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getDisputeCard } from "@/modules/operator";
import { isAppError } from "@/platform/errors";
import { Alert, ButtonLink, Card, Container, DateText, Fact, KeyValueList, PageHeader, StatusBadge } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { AuditList } from "../../_components/AuditList";
import { MoneyBlockView } from "../../_components/MoneyJournal";
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

function Position({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <p className={text ? "text-base break-words whitespace-pre-line text-ink-soft" : "text-base text-muted"}>{text ?? c.noPosition}</p>
    </div>
  );
}

/** Деньги сделки из журнала: блок денег и история операций (ТЗ п. 4.1). */
function DealMoney({ d }: { d: DisputeCard }) {
  return (
    <Card title={c.money}>
      <MoneyBlockView money={d.money} />
      <h3 className="text-lg font-bold text-ink">{c.moneyHistory}</h3>
      {d.moneyHistory.length === 0 ? (
        <p className="text-base text-muted">{c.moneyEmpty}</p>
      ) : (
        <ol className="flex flex-col">
          {d.moneyHistory.map((h) => (
            <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line py-2 text-base last:border-b-0">
              <span className="min-w-0 break-words text-ink">
                {o.money.types[h.type]}, {o.money.status[h.status].toLowerCase()}
              </span>
              <span className="tabular-nums">{formatTiyn(h.amountTiyn)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Decision({ d }: { d: DisputeCard }) {
  if (d.status === "OPEN") {
    return (
      <Card title={c.decisionTitle}>
        {d.aiHintEnabled && <Alert tone="info" title={c.aiHint}>{c.aiHintText}</Alert>}
        <ResolveForm disputeId={d.id} maxShare={formatTiyn(d.deal.priceTiyn)} />
      </Card>
    );
  }
  return (
    <Card title={c.resolvedBy}>
      <dl className="flex flex-col gap-4">
        <Fact label={c.outcomeLabel}>{d.outcome && t.outcomes[d.outcome]}</Fact>
        {d.masterShareTiyn !== null && <Fact label={c.masterShare}>{formatTiyn(d.masterShareTiyn)}</Fact>}
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
          <ButtonLink href={`/operator/deals/${deal.id}`} variant="secondary">
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
              {t.openedAt} <DateText value={d.createdAt} format="dateTime" />. {t.openedIn(o.dealStatus[d.openedInStatus].toLowerCase())}
            </p>
            <Position title={c.description} text={d.description} />
            <Position title={c.clientPosition} text={d.clientPosition} />
            <Position title={c.executorPosition} text={d.executorPosition} />
          </Card>
          <Decision d={d} />
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:row-span-2">
          <DealMoney d={d} />
          <Card title={c.parties}>
            <KeyValueList
              rows={[
                { label: c.client, value: deal.client.fullName ?? o.none },
                { label: c.executor, value: <span className="break-words">{o.deals.card.executorValue(deal.executor.publicNumber, deal.executor.legalName)}</span> },
                { label: c.price, value: <span className="tabular-nums">{formatTiyn(deal.priceTiyn)}</span> },
                { label: c.paid, value: <span className="tabular-nums">{formatTiyn(deal.buyerTotalTiyn)}</span> },
                { label: c.provider, value: o.providers[deal.paymentProvider] },
              ]}
            />
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

        {/* История длинная: на телефоне — в самом конце; на компьютере — под решением. */}
        <Card title={c.history} className="min-w-0 lg:col-start-1">
          <AuditList events={d.history} />
        </Card>
      </div>
    </Container>
  );
}
