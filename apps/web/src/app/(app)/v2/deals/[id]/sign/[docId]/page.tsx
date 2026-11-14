import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signStep } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, Money, Narrow, Notice, PageTitle, Section, Stack } from "@/kit";
import { listDealDocuments } from "@/modules/documents";
import { getDevice } from "@/platform/device";
import { pageHref } from "../../../../../_shell/auth";
import { buyerDealStep, dealCardHref } from "../../pay/_parts/step-gate";
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
 * этой сделки (`buyerDealStep`); документ — из `listDealDocuments` этой сделки, и покупатель — его подписант, иначе 404;
 * подписывать сейчас нечего (уже подписано, не тот шаг сделки) — карточка сделки без ошибки. Порядок: «Назад: <сделка>»,
 * заголовок, «Что вы подписываете» (с PDF в новой вкладке), для акта — что значит подпись и предупреждение о расстоянии,
 * шаг подписи (от руки, затем ЭЦП) и одно главное действие. Компьютер — узкая колонка (`Narrow`): это форма.
 */
export default async function SignPage({ params, searchParams }: Props) {
  const { id, docId } = await params;
  const sp = await searchParams;
  const { user, deal } = await buyerDealStep(pageHref(`/deals/${encodeURIComponent(id)}/sign/${encodeURIComponent(docId)}`, sp), id);
  const [documents, device] = await Promise.all([listDealDocuments(user, deal.id), getDevice()]);
  const doc = documents.find((d) => d.id === docId);
  if (!doc || !isSignKind(doc.kind) || doc.myParty !== "CLIENT") notFound();
  const kind = doc.kind;

  const card = dealCardHref(deal.id);
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
        {/* PDF — обработчик маршрута, а не экран: обычная ссылка в новой вкладке, без перехода и предзагрузки роутера. */}
        <a href={doc.pdfUrl} target="_blank" rel="noopener" className="inline-flex min-h-control w-fit items-center gap-2 text-body font-medium text-ink no-underline hover:underline">
          {t.what.open}
          <span className="sr-only">({t.what.openHint})</span>
          <ExternalLink aria-hidden className="size-4 shrink-0" />
        </a>
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
      <SignArea documentId={doc.id} kind={kind} step={step} dealHref={card} />
    </Stack>
  );
  return device === "desktop" ? <Narrow>{body}</Narrow> : body;
}
