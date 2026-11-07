import { Download, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { openSharedDocument } from "@/modules/documents";
import { Alert, buttonClasses, Container, formatDateTime, PageHeader, StatusBadge } from "@/ui";

const t = ru.documents;

// Ссылку пересылают в мессенджерах: страницу не индексируем, адрес (в нём подпись) не уходит в Referer.
export const metadata: Metadata = { title: t.shared.title, robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Документ по подписанной ссылке (ТЗ п. 7): открывается с телефона без входа, пока не истёк срок.
 * На странице — только вид, номер и статус документа; сам документ — PDF по той же ссылке.
 */
export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await openSharedDocument(token);
  if (!doc) {
    return (
      <Container className="flex flex-col gap-6 py-6">
        <PageHeader title={t.shared.title} back={{ href: "/" }} />
        <Alert tone="warning">{t.shared.invalid}</Alert>
      </Container>
    );
  }
  const base = `/d/${encodeURIComponent(token)}/pdf`;
  return (
    <Container className="flex flex-col gap-6 py-6">
      <PageHeader
        title={`${t.kinds[doc.kind]} № ${doc.number}`}
        description={t.shared.expires(formatDateTime(doc.expiresAt))}
        back={{ href: "/" }}
      />
      <p className="flex flex-wrap items-center gap-2 text-lg text-ink">
        <span>{t.section.version(doc.version)}</span>
        <StatusBadge tone={doc.status === "SIGNED" ? "success" : "neutral"}>{t.status[doc.status]}</StatusBadge>
      </p>
      {doc.status === "SUPERSEDED" && <Alert tone="warning">{t.shared.supersededNote}</Alert>}
      <div className="flex flex-col gap-3">
        <a href={base} target="_blank" rel="noopener" className={buttonClasses({ fullWidth: true })}>
          <ExternalLink aria-hidden className="size-5" />
          {t.section.open}
          <span className="sr-only"> ({t.section.openHint})</span>
        </a>
        <a href={`${base}?download=1`} download className={buttonClasses({ variant: "secondary", fullWidth: true })}>
          <Download aria-hidden className="size-5" />
          {t.section.download}
        </a>
      </div>
      <details className="rounded-control border border-line px-4 py-3">
        <summary className="min-h-12 cursor-pointer text-base font-semibold text-ink">{t.panel.technical}</summary>
        <p className="mt-2 text-base font-semibold text-ink">{t.panel.hash}</p>
        <p className="break-all font-mono text-base text-ink-soft">{doc.sha256}</p>
        <a href={`${base}?original=1`} className="text-base font-semibold text-accent underline underline-offset-4">
          {t.panel.originalPdf}
        </a>
      </details>
    </Container>
  );
}
