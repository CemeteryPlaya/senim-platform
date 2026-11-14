import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Card, formatMoney, MoneyPanel, NowNext, PageTitle, Section, Split, Stack, TextLink } from "@/kit";
import { bankConsentState } from "@/modules/deal-core";
import { readDealDocuments } from "@/modules/documents";
import { consentDocument } from "@/modules/identity";
import { getDevice, type Device } from "@/platform/device";
import { pageHref } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { buyerDealStep, dealCardHref } from "../_parts/step-gate";
import { payMoney, type PayMoney } from "./_parts/pay-view";
import { PayForm } from "./_parts/PayForm";

const t = ru.app.deal.pay;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function Money({ money, device }: { money: PayMoney; device: Device }) {
  const e = t.money.explain;
  return (
    <MoneyPanel
      tone="awaiting"
      title={t.money.title}
      amount={money.amount}
      rows={money.rows.map(({ explain, ...row }) => (explain ? { ...row, explain: { label: e.label, title: e.title, body: <p>{e.body}</p> } } : row))}
      {...(money.failed ? { note: t.money.failed } : {})}
      device={device}
    />
  );
}

function Where() {
  return (
    <Section title={t.where.section}>
      <Card>
        <ul className="flex list-disc flex-col gap-2 pl-6 text-body text-ink marker:text-muted">
          {t.where.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

/**
 * Оплата покупателя. Ворота — покупатель этой сделки (`buyerDealStep`); сейчас не шаг оплаты этого покупателя (оферта не
 * подписана, оплата уже идёт или прошла, сделка отменена, открыт спор — `deal.next` модуля) — карточка сделки без ошибки.
 * Порядок: «Назад: <сделка>», «Оплата», при несогласии мастера — чего ждём (и ссылка на переписку с ним); деньги
 * (`MoneyPanel` «К оплате», суммы — смета модуля, тот же источник, что у карточки сделки); «Где будут деньги»; согласие
 * для банка и главное действие: «Оплатить N ₸», при ручном провайдере — «Оплатить переводом N ₸» с подсказкой про
 * реквизиты оферты (PDF — из `readDealDocuments`, только чтение); пока мастер не дал согласие — «Дать согласие заранее».
 * Компьютер — `Split`: слева деньги, согласие и действие, справа «Где будут деньги».
 */
export default async function PayPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, deal } = await buyerDealStep(pageHref(`/deals/${encodeURIComponent(id)}/pay`, sp), id);
  const card = dealCardHref(deal.id);
  if (deal.next.action !== "pay" || !deal.next.mine) redirect(card);
  const manual = deal.paymentProvider === "MANUAL";
  const [bank, device, documents] = await Promise.all([
    bankConsentState(user, deal.id),
    getDevice(),
    manual ? readDealDocuments(user, deal.id) : Promise.resolve([]),
  ]);
  if (!bank) redirect(card);

  const money = payMoney(deal.estimate, deal.moneyBlock);
  const offer = documents.find((d) => d.kind === "CONTRACT");
  const title = <PageTitle title={t.title} back={{ href: card, label: deal.title }} />;
  // Ссылка на переписку — как на карточке сделки: диалог привязан к отклику сделки.
  const waiting = !bank.other && (
    <Stack gap="tight">
      <NowNext now={{ title: bank.mine ? t.waitMaster.titleMineGiven : t.waitMaster.title, body: t.waitMaster.body }} next={t.waitMaster.next} />
      <TextLink href={to(`/chats/${encodeURIComponent(deal.offerId)}`)}>{t.waitMaster.chat}</TextLink>
    </Stack>
  );
  const form = (
    <PayForm
      dealId={deal.id}
      dealHref={card}
      amount={formatMoney(money.amount)}
      manual={manual ? { offerHref: offer?.pdfUrl ?? null } : null}
      consentGiven={bank.mine}
      document={consentDocument("BANK_TRANSFER")}
      masterReady={bank.other}
    />
  );

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          main={
            <Stack gap="section">
              {waiting}
              <Money money={money} device={device} />
              {form}
            </Stack>
          }
          aside={<Where />}
        />
      </Stack>
    );
  }
  return (
    <Stack gap="section">
      {title}
      {waiting}
      <Money money={money} device={device} />
      <Where />
      {form}
    </Stack>
  );
}
