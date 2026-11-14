import { needsPosition } from "@/features/deal-view/facts";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, Money, Narrow, NowNext, PageTitle, PhotoSlot, Section, Stack, TextLink } from "@/kit";
import type { DealView } from "@/modules/deal-core";
import type { DealSide } from "../../../../_shell/side";
import { dealHrefs } from "../_parts/deal-card";
import { disputeTexts, positionsOf, resolvedRefund, resolvedShare } from "./dispute-view";
import { PositionForm } from "./PositionForm";

export type Dispute = NonNullable<DealView["dispute"]>;

/**
 * Открытый спор: что сейчас, деньги (покупателю — остаток в банке, мастеру — «оплата вам приостановлена» и смета мастера),
 * причина и описание, позиции сторон; форма позиции — если своей ещё нет.
 */
export function OpenState({ deal, side, dispute, photos }: { deal: DealView; side: DealSide; dispute: Dispute; photos: { id: string; src: string }[] }) {
  const t = disputeTexts(side);
  const o = t.open;
  const block = deal.moneyBlock;
  const positions = positionsOf(side, dispute);
  // Покупателю — остаток в банке из журнала; мастеру — его смета (цена по оферте − гарантия 4%), суммы покупателя нет.
  const frozenTiyn = block.kind !== "frozen" ? null : side === "CLIENT" ? block.bankBalanceTiyn : deal.estimate.totalTiyn;
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={o.title} back={{ href: dealHrefs(deal.id).card, label: deal.title }} lead={o.lead(deal.number, formatDateTime(dispute.createdAt))} />
        <NowNext now={o.now} next={o.now.next} />
        {frozenTiyn !== null && (
          <Card padded={false}>
            <List>
              <ListRow label={o.moneyTitle} value={<Money tiyn={frozenTiyn} />} />
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
        {photos.length > 0 && (
          <Section title={o.photosSection}>
            <Card>
              <ul className="grid grid-cols-3 gap-2">
                {photos.map((photo, index) => (
                  <li key={photo.id}>
                    <a href={photo.src} target="_blank" rel="noopener">
                      <PhotoSlot ratio="1/1" src={photo.src} alt={o.photoAlt(index + 1, photos.length)} />
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        )}
        <Section title={o.positionsSection}>
          <Card padded={false}>
            <List>
              <ListRow label={o.yourPosition} value={positions.mine ?? o.noPosition} stacked />
              <ListRow label={side === "CLIENT" ? ru.app.deal.dispute.open.masterPosition : ru.app.masterDispute.open.otherPosition} value={positions.other ?? o.noPosition} stacked />
            </List>
          </Card>
        </Section>
        {needsPosition(deal.viewer, dispute) && <PositionForm disputeId={dispute.id} side={side} />}
      </Stack>
    </Narrow>
  );
}

/**
 * Решённый спор: решение оператора словами, суммы по журналу (покупателю — возврат, мастеру — его часть при разделе),
 * объяснение оператора.
 */
export function ResolvedState({ deal, side, dispute }: { deal: DealView; side: DealSide; dispute: Dispute }) {
  const t = disputeTexts(side);
  const r = t.resolved;
  const text = r.outcome[dispute.outcome ?? "CONTINUE"] ?? r.outcome.CONTINUE;
  const moneyRow =
    side === "CLIENT"
      ? { label: ru.app.deal.dispute.resolved.refundedToYou, tiyn: resolvedRefund(deal.moneyBlock) }
      : { label: ru.app.masterDispute.resolved.shareToYou, tiyn: resolvedShare(deal.moneyBlock) };
  const hrefs = dealHrefs(deal.id);
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={r.title} back={{ href: hrefs.card, label: deal.title }} lead={r.lead(deal.number, formatDateTime(dispute.resolvedAt ?? dispute.createdAt))} />
        <NowNext now={text} />
        {moneyRow.tiyn !== null && (
          <Section title={r.moneySection}>
            <Card padded={false}>
              <List>
                <ListRow label={moneyRow.label} value={<Money tiyn={moneyRow.tiyn} />} />
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
