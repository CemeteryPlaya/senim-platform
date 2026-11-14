import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { needsPosition } from "@/features/deal-view/facts";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, Money, Narrow, NowNext, PageTitle, Section, Stack, TextLink } from "@/kit";
import type { DealView } from "@/modules/deal-core";
import { getDevice } from "@/platform/device";
import { pageHref } from "../../../../_shell/auth";
import { dealHrefs } from "../_parts/deal-card";
import { buyerDeal } from "../_parts/gate";
import { DisputeForm } from "./DisputeForm";
import { disputeScreen, resolvedMoney } from "./dispute-view";
import { PositionForm } from "./PositionForm";

const t = ru.app.deal.dispute;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
type Dispute = NonNullable<DealView["dispute"]>;

/** Открытый спор: что сейчас, деньги в банке, причина и описание, позиции сторон; форма позиции — если своей ещё нет. */
function OpenState({ deal, dispute }: { deal: DealView; dispute: Dispute }) {
  const o = t.open;
  const block = deal.moneyBlock;
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={o.title} back={{ href: dealHrefs(deal.id).card, label: deal.title }} lead={o.lead(deal.number, formatDateTime(dispute.createdAt))} />
        <NowNext now={o.now} next={o.now.next} />
        {block.kind === "frozen" && (
          <Card padded={false}>
            <List>
              <ListRow label={o.moneyTitle} value={<Money tiyn={block.bankBalanceTiyn} />} />
            </List>
          </Card>
        )}
        <Section title={o.aboutSection}>
          <Card padded={false}>
            <List>
              <ListRow label={o.reason} value={t.reasons[dispute.reason] ?? dispute.reason} stacked />
              <ListRow label={o.description} value={dispute.description} stacked />
            </List>
          </Card>
        </Section>
        <Section title={o.positionsSection}>
          <Card padded={false}>
            <List>
              <ListRow label={o.yourPosition} value={dispute.clientPosition ?? o.noPosition} stacked />
              <ListRow label={o.masterPosition} value={dispute.executorPosition ?? o.noPosition} stacked />
            </List>
          </Card>
        </Section>
        {needsPosition(deal.viewer, dispute) && <PositionForm disputeId={dispute.id} />}
      </Stack>
    </Narrow>
  );
}

/** Решённый спор: решение оператора словами, суммы по журналу, объяснение оператора. */
function ResolvedState({ deal, dispute }: { deal: DealView; dispute: Dispute }) {
  const r = t.resolved;
  const text = r.outcome[dispute.outcome ?? "CONTINUE"] ?? r.outcome.CONTINUE;
  const sums = resolvedMoney(deal.moneyBlock);
  const hrefs = dealHrefs(deal.id);
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={r.title} back={{ href: hrefs.card, label: deal.title }} lead={r.lead(deal.number, formatDateTime(dispute.resolvedAt ?? dispute.createdAt))} />
        <NowNext now={text} />
        {(sums.paidToMaster !== undefined || sums.refunded !== undefined) && (
          <Section title={r.moneySection}>
            <Card padded={false}>
              <List>
                {sums.paidToMaster !== undefined && <ListRow label={r.paidToMaster} value={<Money tiyn={sums.paidToMaster} />} />}
                {sums.refunded !== undefined && <ListRow label={r.refundedToYou} value={<Money tiyn={sums.refunded} />} />}
              </List>
            </Card>
          </Section>
        )}
        {dispute.rationale && (
          <Card padded={false}>
            <List>
              <ListRow label={r.rationale} value={dispute.rationale} stacked />
            </List>
          </Card>
        )}
        <Stack>
          <TextLink href={hrefs.money}>{r.moneyHistory}</TextLink>
          <TextLink href={hrefs.card}>{r.toDeal}</TextLink>
        </Stack>
      </Stack>
    </Narrow>
  );
}

/**
 * Спор по сделке покупателя. Экран по состоянию: нет спора и модуль разрешает открыть — форма; спор открыт — его
 * состояние (и форма позиции, если своей нет); решён — итог и деньги; открыть нельзя и спора нет — карточка сделки.
 * Чужая и несуществующая сделка — 404 (`buyerDeal`).
 */
export default async function DisputePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { deal } = await buyerDeal(pageHref(`/deals/${encodeURIComponent(id)}/dispute`, sp), id);
  const hrefs = dealHrefs(deal.id);
  const screen = disputeScreen(deal.dispute, deal.can.openDispute);
  if (screen === "back") redirect(hrefs.card);
  if (screen === "form") return <DisputeForm dealId={deal.id} dealTitle={deal.title} backHref={hrefs.card} device={await getDevice()} />;
  if (!deal.dispute) redirect(hrefs.card);
  return screen === "open" ? <OpenState deal={deal} dispute={deal.dispute} /> : <ResolvedState deal={deal} dispute={deal.dispute} />;
}
