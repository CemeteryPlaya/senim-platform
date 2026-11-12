import { Download, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { openSharedDocument } from "@/modules/documents";
import { Alert, buttonClasses, Container, formatDateTime, KeyValueList, PageHeader, StatusBadge } from "@/ui";

const t = ru.documents;

// Ссылку пересылают в мессенджерах: страницу не индексируем, адрес (в нём подпись) не уходит в Referer.
export const metadata: Metadata = { title: t.shared.title, robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Документ по подписанной ссылке (ТЗ п. 7): открывается с телефона без входа, пока не истёк срок.
 * На странице — только вид, номер и статус документа («метка — значение» в белой карточке); сам документ — PDF
 * по той же ссылке. Главное действие одно — «Открыть»; «Скачать» — второстепенное.
 */
export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await openSharedDocument(token);
  if (!doc) {
    return (
      <Container size="form" className="flex flex-col gap-6 pb-10">
        <PageHeader title={t.shared.title} back={{ href: "/" }} />
        <Alert tone="warning">{t.shared.invalid}</Alert>
      </Container>
    );
  }
  const base = `/d/${encodeURIComponent(token)}/pdf`;
  const rows = t.shared.rows;
  return (
    <Container size="form" className="flex flex-col gap-6 pb-10">
      <PageHeader title={`${t.kinds[doc.kind]} № ${doc.number}`} back={{ href: "/" }} />
      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
        <KeyValueList
          rows={[
            { label: rows.version, value: <span className="tabular-nums">{doc.version}</span> },
            { label: rows.status, value: <StatusBadge tone={doc.status === "SIGNED" ? "success" : "neutral"}>{t.status[doc.status]}</StatusBadge> },
            { label: rows.expires, value: <span className="tabular-nums">{formatDateTime(doc.expiresAt)}</span> },
          ]}
        />
        {doc.status === "SUPERSEDED" && <Alert tone="warning">{t.shared.supersededNote}</Alert>}
        <div className="flex flex-col gap-3">
          {/* <a>, а не ButtonLink: PDF открывается в новой вкладке мимо роутера; метка главного действия — вручную. */}
          <a href={base} target="_blank" rel="noopener" data-primary-action className={buttonClasses({ fullWidth: true })}>
            <ExternalLink aria-hidden className="size-5" />
            {t.section.open}
            <span className="sr-only"> ({t.section.openHint})</span>
          </a>
          <a href={`${base}?download=1`} download className={buttonClasses({ variant: "secondary", fullWidth: true })}>
            <Download aria-hidden className="size-5" />
            {t.section.download}
          </a>
        </div>
      </div>
      <details className="rounded-card border border-line bg-surface px-5 py-3">
        <summary className="min-h-12 cursor-pointer content-center text-base font-semibold text-ink">{t.panel.technical}</summary>
        <p className="mt-2 text-base font-semibold text-ink">{t.panel.hash}</p>
        <p className="font-mono text-base break-all text-ink-soft">{doc.sha256}</p>
        <a
          href={`${base}?original=1`}
          className="inline-flex min-h-control-sm items-center text-base font-semibold text-primary underline underline-offset-4"
        >
          {t.panel.originalPdf}
        </a>
      </details>
    </Container>
  );
}
