"use client";

import { Copy, Download, ExternalLink, MessageCircle, PenLine } from "lucide-react";
import { useState } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import type { SharedLink, SigningDocumentView } from "@/modules/documents/client";
import { Alert, Button, buttonClasses, formatDateTime, StatusBadge } from "@/ui";
import { shareDocumentAction } from "./actions";
import { SignLink } from "./SignLink";
import { documentBadge, signStep } from "./state";

const t = ru.documents;

export type DealDocumentsProps = {
  /** documents.listDealDocuments(user, dealId): оферта, акт, выписка (оператору — и расписка). */
  documents: SigningDocumentView[];
  /** Срок ссылки «Поделиться» в часах — documents.LINK_TTL_HOURS. */
  linkTtlHours: number;
  /** Панели подписи (SigningPanel) — на этом же экране: у документа, который можно подписать, — «Подписать» к его панели. */
  signLinks?: boolean;
  titleAs?: "h2" | "h3";
};

/**
 * Раздел «Документы» карточки сделки (ТЗ п. 7): у каждого документа — статус подписи, «Открыть»,
 * «Скачать» и «Поделиться в WhatsApp» (подписанная ссылка с ограниченным сроком, без персональных данных;
 * оферте ссылка не выдаётся — doc.shareable).
 */
export function DealDocuments({ documents, linkTtlHours, signLinks = false, titleAs: Title = "h2" }: DealDocumentsProps) {
  return (
    <section aria-labelledby="deal-documents-title" className="flex flex-col gap-4">
      <Title id="deal-documents-title" className="text-xl font-semibold text-ink">
        {t.section.title}
      </Title>
      {documents.length === 0 ? (
        <p className="text-base text-muted">{t.section.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} linkTtlHours={linkTtlHours} signLinks={signLinks} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DocumentRow({ doc, linkTtlHours, signLinks }: { doc: SigningDocumentView; linkTtlHours: number; signLinks: boolean }) {
  const status = documentBadge(doc);
  const step = signStep(doc);
  const canSign = step === "hand" || step === "ecp";
  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold text-ink">
          {t.kinds[doc.kind]} № {doc.number}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-base text-muted">
          <span>
            {t.section.version(doc.version)} · {formatDateTime(doc.createdAt)}
          </span>
          <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
        </p>
      </div>
      {/* Вторичная: главное действие экрана — «Подписать оферту / акт» в «Что дальше». */}
      {canSign && signLinks && (
        <SignLink documentId={doc.id} variant="secondary" fullWidth icon={<PenLine />}>
          {t.section.sign}
        </SignLink>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a href={doc.pdfUrl} target="_blank" rel="noopener" className={buttonClasses({ variant: "secondary" })}>
          <ExternalLink aria-hidden className="size-5" />
          {t.section.open}
          <span className="sr-only"> ({t.section.openHint})</span>
        </a>
        <a href={doc.downloadUrl} download className={buttonClasses({ variant: "secondary" })}>
          <Download aria-hidden className="size-5" />
          {t.section.download}
        </a>
      </div>
      {doc.shareable && <ShareArea documentId={doc.id} linkTtlHours={linkTtlHours} />}
    </li>
  );
}

/**
 * «Поделиться в WhatsApp»: сначала сервер выпускает подписанную ссылку, затем — настоящая ссылка wa.me
 * (открывается по нажатию, без блокировки всплывающих окон) и «Скопировать ссылку».
 */
function ShareArea({ documentId, linkTtlHours }: { documentId: string; linkTtlHours: number }) {
  const [link, setLink] = useState<SharedLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await shareDocumentAction({ documentId });
    setBusy(false);
    if (res.ok) setLink(res.data);
    else if (!leaveIfSignedOut(res)) setError(res.error || t.section.shareFailed);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!link) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="ghost" fullWidth loading={busy} onClick={create}>
          <MessageCircle aria-hidden className="size-5" />
          {t.section.share}
        </Button>
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line p-4">
      <p className="text-base text-muted">{t.section.shareHint(linkTtlHours)}</p>
      <p className="text-base text-muted">{t.shared.expires(formatDateTime(link.expiresAt))}</p>
      <label className="flex flex-col gap-1 text-base text-ink">
        {t.section.linkLabel}
        <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="min-h-12 rounded-control border border-line bg-surface px-3 font-mono text-base text-ink" />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a href={link.whatsappUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary" })}>
          <MessageCircle aria-hidden className="size-5" />
          {t.section.share}
        </a>
        <Button variant="secondary" onClick={copy}>
          <Copy aria-hidden className="size-5" />
          {copied ? t.section.copied : t.section.copyLink}
        </Button>
      </div>
      {copied && (
        <p role="status" className="sr-only">
          {t.section.copied}
        </p>
      )}
    </div>
  );
}
