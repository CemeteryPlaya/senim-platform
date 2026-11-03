import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getOperatorDeal, type OperatorDeal, type ReleasePackage } from "@/modules/operator";
import { isAppError } from "@/platform/errors";
import { Alert, ButtonLink, Card, Container, Fact, PageHeader, StatusBadge } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { DealDocuments } from "../../_components/DealDocuments";
import { MoneyBlockView, MoneyJournal } from "../../_components/MoneyJournal";
import { requireOperatorPage } from "../../_lib/guard";
import { OperationActions } from "../../money/OperationForms";
import { ReceiptForm } from "./ReceiptForm";

const o = ru.operator;
const t = o.deals;
const c = t.card;
const r = t.release;

export const metadata: Metadata = { title: t.title };

async function load(user: Awaited<ReturnType<typeof requireOperatorPage>>, id: string) {
  try {
    return await getOperatorDeal(user, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

/** Пакет для банка на раскрытие (docs/bank/03 раздел 4): акт с подписями, расписка, суммы раздела из журнала. */
function ReleasePackageCard({ dealId, pack }: { dealId: string; pack: ReleasePackage }) {
  return (
    <Card title={r.title} description={pack.done ? r.done : r.description}>
      <dl className="flex flex-col gap-4">
        <Fact label={r.total}>{formatTiyn(pack.releaseTiyn)}</Fact>
        <Fact label={r.master}>{formatTiyn(pack.masterTiyn)}</Fact>
        <Fact label={r.platform}>{formatTiyn(pack.platformTiyn)}</Fact>
        <Fact label={r.act}>
          {pack.act ? (
            <a href={`/api/documents/${pack.act.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {o.documents.kinds.ACCEPTANCE_ACT} {pack.act.number}
            </a>
          ) : (
            r.actMissing
          )}
        </Fact>
        <Fact label={r.receipt}>
          <span className="flex flex-col gap-1">
            {pack.receipt ? (
              <a href={`/api/documents/${pack.receipt.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {r.openPdf}: {pack.receipt.number}
              </a>
            ) : (
              <ReceiptForm dealId={dealId} />
            )}
            <StatusBadge tone="warning" className="self-start">
              {r.legalReview}
            </StatusBadge>
          </span>
        </Fact>
      </dl>
    </Card>
  );
}

function Summary({ deal }: { deal: OperatorDeal["deal"] }) {
  return (
    <Card title={c.summary}>
      <dl className="flex flex-col gap-4">
        <Fact label={c.client}>{deal.clientName ?? o.none}</Fact>
        <Fact label={c.executor}>
          <span className="break-words">{c.executorValue(deal.executorNumber, deal.executorName)}</span>
        </Fact>
        <Fact label={c.offer}>{deal.signedAt ? c.offerSigned : c.offerNotSigned}</Fact>
        <Fact label={c.price}>{formatTiyn(deal.priceTiyn)}</Fact>
        <Fact label={c.buyerTotal}>{formatTiyn(deal.buyerTotalTiyn)}</Fact>
        <Fact label={c.payout}>{formatTiyn(deal.payoutTiyn)}</Fact>
        <Fact label={c.platformIncome}>{formatTiyn(deal.platformIncomeTiyn)}</Fact>
        <Fact label={c.provider}>{o.providers[deal.provider]}</Fact>
      </dl>
    </Card>
  );
}

/** Карточка сделки оператора: деньги первым блоком, ждущие операции с кнопками, пакет на раскрытие, документы. */
export default async function OperatorDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOperatorPage(`/operator/deals/${id}`);
  const card = await load(user, id);
  const { deal } = card;

  return (
    <Container className="pb-10">
      <PageHeader
        title={c.title(deal.number)}
        description={deal.title}
        back={{ href: "/operator/deals" }}
        actions={
          <ButtonLink href={`/operator/audit?deal=${deal.number}`} variant="secondary">
            {c.audit}
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label={c.money} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="info">{o.dealStatus[deal.status]}</StatusBadge>
              {deal.isDemo && <StatusBadge tone="neutral">{o.testMark}</StatusBadge>}
            </div>
            <MoneyBlockView money={card.money} />
            {card.openDisputeId && (
              <Alert tone="warning" action={<ButtonLink href={`/operator/disputes/${card.openDisputeId}`} variant="secondary">{c.dispute}</ButtonLink>}>
                {t.disputeOpen}
              </Alert>
            )}
          </section>

          {card.pending.length > 0 && (
            <Card title={c.pendingTitle}>
              <ul className="flex flex-col gap-6">
                {card.pending.map((op) => (
                  <li key={op.id} className="flex flex-col gap-3 border-b border-line pb-6 last:border-b-0 last:pb-0">
                    <h3 className="flex flex-wrap justify-between gap-x-3 text-lg font-bold text-ink">
                      <span>{o.money.types[op.type]}</span>
                      <span className="tabular-nums">{formatTiyn(op.amountTiyn)}</span>
                    </h3>
                    <OperationActions transactionId={op.id} type={op.type} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {card.releasePackage && <ReleasePackageCard dealId={deal.id} pack={card.releasePackage} />}

          <Card title={c.journal} description={c.journalHint}>
            <MoneyJournal rows={card.journal} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Summary deal={deal} />
          <Card title={c.documents}>
            <DealDocuments documents={card.documents} />
          </Card>
        </div>
      </div>
    </Container>
  );
}
