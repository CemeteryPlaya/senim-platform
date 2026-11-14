import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signStep } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, Money, Narrow, Notice, PageTitle, Section, Stack, TextLink } from "@/kit";
import { readDealDocuments } from "@/modules/documents";
import { getDevice } from "@/platform/device";
import { pageHref } from "../../../../../_shell/auth";
import { dealHrefs } from "../../_parts/deal-card";
import { buyerDeal } from "../../_parts/gate";
import { SignArea } from "./_parts/SignArea";
import { farWarning, isSignKind, stepView, whatRows, type WhatRow } from "./_parts/sign-view";

const t = ru.app.deal.sign;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string; docId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function Row({ row }: { row: WhatRow }) {
  if ("amount" in row) {
    return <ListRow label={row.total ? <span className="font-semibold text-ink">{row.label}</span> : row.label} value={<Money tiyn={row.amount} />} />;
  }
  return <ListRow label={row.label} value={row.value} />;
}

/**
 * Подпись документа сделки покупателем — один экран для оферты и акта приёмки (вид — из данных модуля). Ворота — покупатель
 * этой сделки (`buyerDeal`, чужая сделка — 404); документы — `readDealDocuments` (только чтение, выписка не выпускается).
 * Документа нет среди действующих документов своей сделки (заменён новой редакцией, старая ссылка) или подписывать сейчас
 * нечего (уже подписано, не тот шаг сделки, открыт спор) — карточка сделки без ошибки: её главное действие ведёт на
 * действующую редакцию. Документ есть, но это не оферта/акт или покупатель не его подписант — 404. Порядок: «Назад: <сделка>»,
 * заголовок, «Что вы подписываете» (с PDF в новой вкладке), для акта — что значит подпись и предупреждение о расстоянии,
 * шаг подписи (от руки, затем ЭЦП) и одно главное действие. Компьютер — узкая колонка (`Narrow`): это форма.
 */
export default async function SignPage({ params, searchParams }: Props) {
  const { id, docId } = await params;
  const sp = await searchParams;
  const { user, deal } = await buyerDeal(pageHref(`/deals/${encodeURIComponent(id)}/sign/${encodeURIComponent(docId)}`, sp), id);
  const [documents, device] = await Promise.all([readDealDocuments(user, deal.id), getDevice()]);
  const card = dealHrefs(deal.id).card;
  const doc = documents.find((d) => d.id === docId);
  // Своя сделка, а документа среди действующих нет: заменённая редакция или старая ссылка. Ответ один и тот же для любого
  // id — о чужих документах он ничего не говорит; карточка ведёт к действующей редакции.
  if (!doc) redirect(card);
  if (!isSignKind(doc.kind) || doc.myParty !== "CLIENT") notFound();
  const kind = doc.kind;

  const step = stepView(doc, signStep(doc));
  if (!step) redirect(card);

  const rows = whatRows({
    kind,
    number: doc.number,
    executorLabel: deal.executorLabel,
    buyerName: user.fullName,
    estimate: deal.estimate,
    durationDays: deal.durationDays,
    warrantyMonths: deal.warrantyMonths,
    readyAt: deal.dates.readyAt,
  });
  const far = farWarning(kind, deal.ready);

  const body: ReactNode = (
    <Stack gap="section">
      <PageTitle title={t.title[kind]} back={{ href: card, label: deal.title }} />
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
          {t.what.open}
        </TextLink>
      </Section>
      {kind === "ACCEPTANCE_ACT" && (
        <Stack>
          {far && (
            <Notice tone="warn" title={t.act.farTitle}>
              <p>{far}</p>
            </Notice>
          )}
          <Card>
            <Stack gap="tight">
              <p className="text-body text-ink">{t.act.meaning}</p>
              <p className="text-body text-muted">{t.act.notLiked}</p>
            </Stack>
          </Card>
        </Stack>
      )}
      <SignArea documentId={doc.id} kind={kind} step={step} dealHref={card} device={device} fullName={user.fullName ?? ""} />
    </Stack>
  );
  return device === "desktop" ? <Narrow>{body}</Narrow> : body;
}
