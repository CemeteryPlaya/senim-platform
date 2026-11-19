import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Card, KeyValueList, Money, MoneyPanel, Notice, PageTitle, Section, Split, Stack, StatusChip, TextLink, Timeline } from "@/kit";
import { getOperatorDeal, type OperatorDeal, type ReleasePackage } from "@/modules/operator";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireOperator } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { documentPdfHref } from "../../../deals/[id]/money/money-view";
import { DealDocuments } from "../_parts/DealDocuments";
import { dealMoney, journalTimeline } from "../_parts/deal-view";
import { ReceiptForm } from "./ReceiptForm";

const t = ru.app.operatorDeals;
const c = t.card;
const r = t.release;

export const metadata: Metadata = { title: c.metaTitle };

type Props = { params: Promise<{ id: string }> };

async function load(user: Awaited<ReturnType<typeof requireOperator>>, id: string) {
  try {
    return await getOperatorDeal(user, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

/** Пакет для банка на раскрытие (docs/bank/03, раздел 4): суммы раздела из журнала, акт с подписями, расписка. */
function ReleaseSection({ dealId, pack }: { dealId: string; pack: ReleasePackage }) {
  const link = (id: string, label: string) => (
    <TextLink href={documentPdfHref(id)} external>
      {label}
    </TextLink>
  );
  return (
    <Section title={r.title} id="release">
      <p className="text-body text-muted desktop:max-w-measure">{pack.done ? r.done : r.lead}</p>
      <Card padded={false}>
        <KeyValueList
          items={[
            { label: r.total, value: <Money tiyn={pack.releaseTiyn} /> },
            { label: r.master, value: <Money tiyn={pack.masterTiyn} /> },
            { label: r.platform, value: <Money tiyn={pack.platformTiyn} /> },
            { label: r.act, value: pack.act ? link(pack.act.id, t.documents.open(t.documents.kinds.ACCEPTANCE_ACT, pack.act.number)) : r.actMissing },
            {
              label: r.receipt,
              value: pack.receipt ? (
                link(pack.receipt.id, r.receiptOpen(pack.receipt.number))
              ) : (
                <Stack gap="tight">
                  <ReceiptForm dealId={dealId} />
                  <StatusChip tone="warn">{r.legalReview}</StatusChip>
                </Stack>
              ),
            },
          ]}
        />
      </Card>
    </Section>
  );
}

function Summary({ deal }: { deal: OperatorDeal["deal"] }) {
  return (
    <Section title={c.summary} id="summary">
      <Card padded={false}>
        <KeyValueList
          items={[
            { label: c.client, value: deal.clientName ?? t.none },
            { label: c.executor, value: c.executorValue(deal.executorNumber, deal.executorName) },
            { label: c.offer, value: deal.signedAt ? c.offerSigned : c.offerNotSigned },
            { label: c.price, value: <Money tiyn={deal.priceTiyn} /> },
            { label: c.buyerTotal, value: <Money tiyn={deal.buyerTotalTiyn} /> },
            { label: c.payout, value: <Money tiyn={deal.payoutTiyn} /> },
            { label: c.platformIncome, value: <Money tiyn={deal.platformIncomeTiyn} /> },
            { label: c.provider, value: t.providers[deal.provider] },
          ]}
        />
      </Card>
    </Section>
  );
}

/**
 * Карточка сделки оператора: деньги первым блоком — по журналу, а не по статусу; ждущие операции manual со ссылкой в очередь
 * денег (подтверждение и отказ банка там, со свежим кодом); пакет для банка на раскрытие и «Сформировать расписку»; журнал денег
 * с пометкой тестовой операции (она видна только оператору); сделка, документы с подписями и хэшами. Главной кнопки нет:
 * это экран чтения, расписка — второстепенное действие. Несуществующая сделка — 404.
 */
export default async function OperatorDealPage({ params }: Props) {
  const { id } = await params;
  const user = await requireOperator(to(`/operator/deals/${encodeURIComponent(id)}`));
  const [card, device] = await Promise.all([load(user, id), getDevice()]);
  const { deal } = card;
  const money = dealMoney(card.money);

  return (
    <Stack gap="section">
      <PageTitle title={c.title(deal.number)} back={{ href: to("/operator/deals"), label: c.back }} lead={deal.title} />
      <Split
        main={
          <Stack gap="section">
            <Section title={c.now} id="money">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone="neutral">{t.dealStatus[deal.status]}</StatusChip>
                {deal.isTest && <StatusChip tone="neutral">{t.testMark}</StatusChip>}
              </div>
              <MoneyPanel tone={money.tone} title={money.title} amount={money.amount} rows={money.rows} {...(money.note ? { note: money.note } : {})} device={device} />
              {card.openDisputeId && (
                <Notice tone="warn" title={c.dispute}>
                  <TextLink href={to(`/operator/disputes/${encodeURIComponent(card.openDisputeId)}`)}>{c.openDispute}</TextLink>
                </Notice>
              )}
            </Section>
            {card.pending.length > 0 && (
              <Section title={c.pendingTitle} id="pending">
                <p className="text-body text-muted desktop:max-w-measure">{c.pendingLead}</p>
                <Card padded={false}>
                  <KeyValueList items={card.pending.map((op) => ({ label: t.moneyTypes[op.type], value: <Money tiyn={op.amountTiyn} /> }))} />
                </Card>
                <TextLink href={to("/operator/money")}>{c.pendingLink}</TextLink>
              </Section>
            )}
            {card.releasePackage && <ReleaseSection dealId={deal.id} pack={card.releasePackage} />}
            <Section title={c.journal} id="journal">
              <p className="text-body text-muted desktop:max-w-measure">{c.journalHint}</p>
              <Card>
                {card.journal.length === 0 ? (
                  <p className="text-body text-muted">{c.journalEmpty}</p>
                ) : (
                  <Timeline label={c.journal} items={journalTimeline(card.journal)} />
                )}
              </Card>
            </Section>
          </Stack>
        }
        aside={
          <Stack gap="section">
            <Summary deal={deal} />
            <Section title={c.documents} id="documents">
              <DealDocuments documents={card.documents} />
            </Section>
            <TextLink href={to(`/operator/requests/${deal.requestNumber}`)}>{ru.app.operatorDisputes.requestFiles.link}</TextLink>
            <TextLink href={`${to("/operator/audit")}?deal=${deal.number}`}>{c.audit}</TextLink>
          </Stack>
        }
      />
    </Stack>
  );
}
