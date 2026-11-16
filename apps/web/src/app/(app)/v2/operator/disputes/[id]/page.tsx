import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Card, KeyValueList, List, ListRow, Money, MoneyPanel, Notice, PageTitle, Section, Split, Stack, StatusChip, TextLink, Timeline } from "@/kit";
import { getDisputeCard } from "@/modules/operator";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireOperator } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { disputeMoney, disputeTone, historyTimeline, moneyTimeline, openedLine } from "../dispute-view";
import { ResolveForm } from "./ResolveForm";

const t = ru.app.operatorDisputes;
const c = t.card;

export const metadata: Metadata = { title: c.metaTitle };

type Props = { params: Promise<{ id: string }> };

async function loadCard(user: Awaited<ReturnType<typeof requireOperator>>, id: string) {
  try {
    return await getDisputeCard(user, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

type Card_ = Awaited<ReturnType<typeof loadCard>>;

/** Позиция стороны: заголовок и текст строкой «подпись — значение»; нет текста — «сторона ещё не написала». */
function positions(d: Card_) {
  const text = (value: string | null) => <span className="whitespace-pre-line">{value ?? c.noPosition}</span>;
  return [
    { label: c.description, value: text(d.description) },
    { label: c.clientPosition, value: text(d.clientPosition) },
    { label: c.executorPosition, value: text(d.executorPosition) },
  ];
}

/** Решение: открытый спор — форма (код из приложения — по запросу); решённый — итог, сумма мастеру, обоснование, кто и когда. */
function Decision({ d, mobile }: { d: Card_; mobile: boolean }) {
  if (d.status === "OPEN") {
    return (
      <Section title={t.decision.title} id="decision">
        {d.aiHintEnabled && (
          <Notice tone="info" title={c.aiHint}>
            {c.aiHintText}
          </Notice>
        )}
        <Card>
          <ResolveForm disputeId={d.id} maxTiyn={d.deal.priceTiyn} mobile={mobile} />
        </Card>
      </Section>
    );
  }
  const r = t.resolved;
  return (
    <Section title={r.title} id="decision">
      <Card padded={false}>
        <KeyValueList
          items={[
            { label: r.outcome, value: d.outcome ? t.disputes.outcomes[d.outcome] : t.none },
            ...(d.masterShareTiyn !== null ? [{ label: r.masterShare, value: <Money tiyn={d.masterShareTiyn} /> }] : []),
            { label: r.rationale, value: <span className="whitespace-pre-line">{d.rationale ?? t.none}</span> },
            ...(d.resolvedAt ? [{ label: r.resolvedAt, value: r.resolvedBy(formatDateTime(d.resolvedAt), d.resolvedBy?.fullName ?? null) }] : []),
          ]}
        />
      </Card>
    </Section>
  );
}

/**
 * Карточка спора: что сейчас (статус, причина, этап сделки), позиции сторон, решение; рядом — деньги сделки по журналу,
 * стороны и вложения; ниже — журнал денег и история сделки. Открытый спор — форма решения с расчётом раздела и кодом из
 * приложения. Единственное главное действие — «Принять решение» (у решённого спора его нет). Несуществующий спор — 404.
 */
export default async function DisputeCardPage({ params }: Props) {
  const { id } = await params;
  const user = await requireOperator(to(`/operator/disputes/${encodeURIComponent(id)}`));
  const [d, device] = await Promise.all([loadCard(user, id), getDevice()]);
  const { deal } = d;
  const money = disputeMoney(d.money);

  return (
    <Stack gap="section">
      <PageTitle title={c.title(deal.number)} back={{ href: to("/operator/disputes"), label: c.back }} lead={deal.title} />
      <Split
        main={
          <Stack gap="section">
            <Section title={c.now} id="now">
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={disputeTone(d.status)}>{t.disputes.status[d.status]}</StatusChip>
                  <StatusChip tone="neutral">{t.disputes.reasons[d.reason]}</StatusChip>
                  <StatusChip tone="neutral">{t.dealStatus[deal.status]}</StatusChip>
                </div>
                <p className="mt-3 text-body text-muted">{openedLine(d.createdAt, d.openedInStatus)}</p>
              </Card>
            </Section>
            <Section title={c.positions} id="positions">
              <Card padded={false}>
                <List>
                  {positions(d).map((p) => (
                    <ListRow key={p.label} label={p.label} value={p.value} stacked />
                  ))}
                </List>
              </Card>
            </Section>
            <Decision d={d} mobile={device === "mobile"} />
          </Stack>
        }
        aside={
          <Stack gap="section">
            <Section title={t.money.section} id="money">
              <MoneyPanel tone={money.tone} title={money.title} amount={money.amount} rows={money.rows} {...(money.note ? { note: money.note } : {})} device={device} />
            </Section>
            <Section title={c.parties} id="parties">
              <Card padded={false}>
                <List>
                  <ListRow label={c.client} value={deal.client.fullName ?? t.none} stacked />
                  <ListRow label={c.executor} value={c.executorValue(deal.executor.publicNumber, deal.executor.legalName)} stacked />
                  <ListRow label={c.price} value={<Money tiyn={deal.priceTiyn} />} stacked />
                  <ListRow label={c.paid} value={<Money tiyn={deal.buyerTotalTiyn} />} stacked />
                  <ListRow label={c.provider} value={c.providers[deal.paymentProvider]} stacked />
                </List>
              </Card>
              <TextLink href={to(`/operator/deals/${encodeURIComponent(deal.id)}`)}>{c.openDeal}</TextLink>
            </Section>
            <Section title={c.attachments} id="attachments">
              <Card>
                {d.attachments.length === 0 ? (
                  <p className="text-body text-muted">{c.noAttachments}</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {d.attachments.map((a) => (
                      <li key={a.id} className="flex flex-col gap-1">
                        <TextLink href={a.url} external>
                          {c.attachment(a.contentType, Math.ceil(a.size / 1024))}
                        </TextLink>
                        <p className="text-small wrap-anywhere text-muted">
                          {c.attachmentHash}: {a.sha256}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Section>
          </Stack>
        }
      />
      <Section title={t.money.history} id="money-history">
        <Card>{d.moneyHistory.length === 0 ? <p className="text-body text-muted">{t.money.historyEmpty}</p> : <Timeline label={t.money.history} items={moneyTimeline(d.moneyHistory)} />}</Card>
      </Section>
      <Section title={c.history} id="history">
        <Card>{d.history.length === 0 ? <p className="text-body text-muted">{c.historyEmpty}</p> : <Timeline label={c.history} items={historyTimeline(d.history)} />}</Card>
      </Section>
    </Stack>
  );
}
