import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signStep } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, Money, Narrow, Notice, NowNext, PageTitle, Section, Split, Stack, TextLink } from "@/kit";
import { bankConsentState, type BankConsentState, type DealView } from "@/modules/deal-core";
import { readDealDocuments } from "@/modules/documents";
import { consentDocument, type CurrentUser } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { logger } from "@/platform/logger";
import { pageHref, partyDeal, requireV2User } from "../../../../../_shell/auth";
import { legacy } from "../../../../../_shell/paths";
import { dealHrefs } from "../../_parts/deal-card";
import { ConsentStep } from "./_parts/ConsentStep";
import { SignArea } from "./_parts/SignArea";
import { farWarning, isSignKind, signTitle, stepView, whatRows, type WhatRow } from "./_parts/sign-view";

const t = ru.app.deal.sign;
const tm = ru.app.masterSteps.sign;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string; docId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function Row({ row }: { row: WhatRow }) {
  if ("amount" in row) {
    return <ListRow label={row.total ? <span className="font-semibold text-ink">{row.label}</span> : row.label} value={<Money tiyn={row.amount} />} />;
  }
  return <ListRow label={row.label} value={row.value} />;
}

/**
 * Отметки согласия для банка — только мастеру и только для оферты, пока сделка CREATED (`bankConsentState`, иначе `null`).
 * Сбой чтения (identity недоступна) не роняет экран: замка в интерфейсе нет, а действие подписи само проверит отметку.
 */
async function masterBank(user: CurrentUser, deal: DealView, kind: string): Promise<BankConsentState | null> {
  if (deal.viewer !== "EXECUTOR" || kind !== "CONTRACT" || deal.status !== "CREATED") return null;
  return bankConsentState(user, deal.id).catch((error: unknown) => {
    logger.warn("bank consent state failed", { dealId: deal.id, error });
    return null;
  });
}

/**
 * Подпись документа сделки стороной — один экран для оферты и акта приёмки, для покупателя и мастера (вид — из данных
 * модуля, сторона — из документа). Ворота — `partyDeal` (сторона в активной роли; в другой своей роли — переключение с
 * возвратом сюда; оператор — v1; чужая — 404); документы — `readDealDocuments` (только чтение, выписка не выпускается).
 * Документа нет среди действующих документов своей сделки (заменён новой редакцией, старая ссылка) или подписывать сейчас
 * нечего (уже подписано, не тот шаг сделки, открыт спор) — карточка сделки без ошибки. Документ есть, но это не оферта/акт
 * или смотрящий не его подписант — 404.
 *
 * Покупатель: оферта и акт — от руки, затем ЭЦП. Мастер: оферта — от руки и ЭЦП, перед подписью — согласие для банка
 * (текст с прокруткой и отметка над подписью; без отметки подпись закрыта с объяснением); акт — ЭЦП (подпись мастера акта
 * от руки — только при флаге `executorHandSignsAct`, в v2 не перенесена: такой шаг уходит в v1). Оферта мастером уже
 * подписана, а согласия нет (Ruling 7) — экран согласия с единственным действием «Дать согласие».
 * «Что вы подписываете» — по стороне: мастеру — его суммы из сметы модуля («Вы получите»), без сумм покупателя.
 * Компьютер — `Split`: слева подпись и кнопка (видна без прокрутки), справа «Что вы подписываете» со ссылкой на документ.
 */
export default async function SignPage({ params, searchParams }: Props) {
  const { id, docId } = await params;
  const sp = await searchParams;
  const here = pageHref(`/deals/${encodeURIComponent(id)}/sign/${encodeURIComponent(docId)}`, sp);
  const user = await requireV2User(here);
  const { deal, side } = await partyDeal(user, id, { here });
  const [documents, device] = await Promise.all([readDealDocuments(user, deal.id), getDevice()]);
  const card = dealHrefs(deal.id).card;
  const doc = documents.find((d) => d.id === docId);
  // Своя сделка, а документа среди действующих нет: заменённая редакция или старая ссылка. Ответ один и тот же для любого
  // id — о чужих документах он ничего не говорит; карточка ведёт к действующей редакции.
  if (!doc) redirect(card);
  if (!isSignKind(doc.kind) || doc.myParty !== side) notFound();
  const kind = doc.kind;
  const master = side === "EXECUTOR";
  const raw = signStep(doc);
  // Подпись акта мастером от руки требуется только при флаге executorHandSignsAct — этот шаг в v2 не перенесён.
  if (master && kind === "ACCEPTANCE_ACT" && raw === "hand") redirect(legacy(card));
  const bank = await masterBank(user, deal, kind);
  const step = stepView(doc, raw);
  const title = <PageTitle title={!step && bank && !bank.mine ? tm.consentTitle : signTitle(kind, side)} back={{ href: card, label: deal.title }} />;

  if (!step) {
    if (!bank || bank.mine) redirect(card);
    // Ruling 7: оферта подписана, своего согласия для банка нет — без него банк не примет оплату покупателя.
    return (
      <Narrow>
        <Stack gap="section">
          {title}
          <NowNext now={tm.consent.now} next={tm.consent.next} />
          <ConsentStep dealId={deal.id} dealHref={card} document={consentDocument("BANK_TRANSFER")} />
        </Stack>
      </Narrow>
    );
  }

  const rows = whatRows({
    side,
    kind,
    number: doc.number,
    executorLabel: deal.executorLabel,
    buyerName: user.fullName,
    estimate: deal.estimate,
    durationDays: deal.durationDays,
    warrantyMonths: deal.warrantyMonths,
    readyAt: deal.dates.readyAt,
  });
  const far = farWarning(kind, deal.ready, side);

  const what: ReactNode = (
    <Section title={t.what.section}>
      <Card padded={false}>
        <List>
          {rows.map((row) => (
            <Row key={row.label} row={row} />
          ))}
        </List>
      </Card>
      {/* PDF — обработчик маршрута, а не экран: обычная ссылка в новой вкладке (`external`). */}
      <TextLink href={doc.pdfUrl} external>
        {ru.app.deal.openDocument[kind]}
      </TextLink>
    </Section>
  );
  const farNotice = far && (
    <Notice tone="warn" title={master ? tm.act.farTitle : t.act.farTitle}>
      <p>{far}</p>
    </Notice>
  );
  const meaning = kind === "ACCEPTANCE_ACT" && (
    <Card>
      {master ? (
        <p className="text-body text-ink">{tm.act.meaning}</p>
      ) : (
        <Stack gap="tight">
          <p className="text-body text-ink">{t.act.meaning}</p>
          <p className="text-body text-muted">{t.act.notLiked}</p>
        </Stack>
      )}
    </Card>
  );
  // Согласие мастера для банка уже дано — подпись открыта; строка об этом над подписью.
  const consentGiven = bank?.mine && (
    <Card>
      <Stack gap="tight">
        <p className="text-card text-ink">{tm.consent.given}</p>
        <p className="text-body text-muted">{tm.consent.givenBody}</p>
      </Stack>
    </Card>
  );
  const area = (
    <SignArea
      dealId={deal.id}
      documentId={doc.id}
      kind={kind}
      side={side}
      step={step}
      dealHref={card}
      device={device}
      fullName={user.fullName ?? ""}
      consent={bank && !bank.mine ? { document: consentDocument("BANK_TRANSFER") } : null}
    />
  );

  // Компьютер — две колонки: слева подпись (предупреждение о расстоянии, согласие, шаг, холст или ЭЦП, кнопка — видна без
  // прокрутки), справа «Что вы подписываете», ссылка на документ и что значит подпись акта.
  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          main={
            <Stack gap="section">
              {farNotice}
              {consentGiven}
              {area}
            </Stack>
          }
          aside={
            <Stack gap="section">
              {what}
              {meaning}
            </Stack>
          }
        />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      {what}
      {kind === "ACCEPTANCE_ACT" && (
        <Stack>
          {farNotice}
          {meaning}
        </Stack>
      )}
      {consentGiven}
      {area}
    </Stack>
  );
}
