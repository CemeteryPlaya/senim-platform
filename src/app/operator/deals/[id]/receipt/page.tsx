import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getOperatorDeal } from "@/modules/operator";
import { isAppError } from "@/platform/errors";
import { Alert, Card, Container, DateText, Fact, PageHeader } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { requireOperatorPage } from "../../../_lib/guard";
import { PrintButton } from "./PrintButton";

const o = ru.operator;
const p = o.deals.receiptPage;
const r = o.deals.release;

export const metadata: Metadata = { title: r.receipt, robots: { index: false, follow: false } };

/**
 * Шаблон расписки на раскрытие для печати — пока documents не формирует RELEASE_RECEIPT в PDF.
 * INTEGRATOR: documents.createReleaseReceipt — тогда карточка сделки ведёт на PDF, эта страница остаётся запасной.
 * Суммы — из журнала денег (дочерние операции RELEASE), не из статуса сделки.
 */
export default async function ReleaseReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOperatorPage(`/operator/deals/${id}/receipt`);
  const card = await getOperatorDeal(user, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const pack = card.releasePackage;
  if (!pack) notFound();
  const { deal } = card;

  return (
    <Container size="form" className="pb-10">
      <PageHeader title={p.title(deal.number)} back={{ href: `/operator/deals/${deal.id}` }} />
      <div className="flex flex-col gap-6">
        <Alert tone="warning">{p.legalReview}</Alert>
        <Card>
          <p className="text-base text-ink">{p.text(deal.number)}</p>
          <dl className="flex flex-col gap-4">
            <Fact label={p.deal}>{o.money.deal(deal.number, deal.title)}</Fact>
            <Fact label={p.client}>{deal.clientName ?? o.none}</Fact>
            <Fact label={p.executor}>{deal.executorName}</Fact>
            <Fact label={p.act}>
              <span className="break-all">{pack.act ? p.actValue(pack.act.number, pack.act.sha256) : r.actMissing}</span>
            </Fact>
            <Fact label={r.total}>{formatTiyn(pack.releaseTiyn)}</Fact>
            <Fact label={r.master}>{formatTiyn(pack.masterTiyn)}</Fact>
            <Fact label={r.platform}>{formatTiyn(pack.platformTiyn)}</Fact>
            <Fact label={p.date}>
              <DateText value={new Date()} />
            </Fact>
          </dl>
        </Card>
        <PrintButton label={p.print} />
      </div>
    </Container>
  );
}
