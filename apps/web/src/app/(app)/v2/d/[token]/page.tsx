import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { formatDateTime } from "@/features/format/format";
import { ActionDock, ButtonLink, Card, Explain, List, ListRow, Narrow, PageTitle, Stack, StatusChip } from "@/kit";
import { openSharedDocument } from "@/modules/documents";
import { getDevice } from "@/platform/device";
import { to } from "../../../_shell/paths";

const t = ru.app.deal.shared;
const docs = ru.app.deal.card.documents;

/** Статус словами по роду документа: подписывается только акт, у выписки подписи нет. */
function statusText(doc: { kind: string; status: "SIGNING" | "SIGNED" | "SUPERSEDED" }): string {
  return doc.kind === "ACCEPTANCE_ACT" ? t.status.ACCEPTANCE_ACT[doc.status] : t.status.notSigned;
}

// Ссылку пересылают в мессенджерах: страницу не индексируем, адрес (в нём подпись) не уходит в Referer.
export const metadata: Metadata = { title: t.metaTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Документ по подписанной ссылке (ТЗ п. 7): открывается с телефона без входа, пока ссылка действует. Вид, номер, версия,
 * статус и срок ссылки; сам документ — PDF по этой же ссылке. Недействительная и просроченная ссылка — 404.
 * Вошедшему показывается в обычной оболочке, гостю — в гостевой (решает layout).
 */
export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await openSharedDocument(token);
  if (!doc) notFound();
  const device = await getDevice();
  const base = to(`/d/${encodeURIComponent(token)}/pdf`);
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title(docs.kinds[doc.kind], doc.number)} back={{ href: to("/"), label: t.back }} />
        <Card padded={false}>
          <List>
            <ListRow label={t.rows.version} value={<span className="tabular-nums">{doc.version}</span>} />
            <ListRow
              label={t.rows.status}
              value={<StatusChip tone={doc.status === "SIGNED" ? "accent" : "neutral"}>{statusText(doc)}</StatusChip>}
            />
            <ListRow label={t.rows.expires} value={<span className="tabular-nums">{formatDateTime(doc.expiresAt)}</span>} />
          </List>
        </Card>
        {doc.status === "SUPERSEDED" && <p className="text-body text-muted">{t.superseded}</p>}
        <Explain label={t.technical.label} title={t.technical.title} device={device}>
          <p className="text-sub text-muted">{t.technical.hash}</p>
          <p className="font-mono text-body break-all text-ink">{doc.sha256}</p>
          <p className="mt-2">
            <a href={`${base}?original=1`} className="text-body font-medium text-accent underline underline-offset-4">
              {t.technical.original}
            </a>
          </p>
        </Explain>
        <ActionDock>
          <ButtonLink href={base} target="_blank" rel="noopener" prefetch={false}>
            {ru.app.deal.openDocument[doc.kind]}
            <span className="sr-only"> ({t.openHint})</span>
          </ButtonLink>
          <ButtonLink href={`${base}?download=1`} variant="quiet" download prefetch={false}>
            {t.download}
          </ButtonLink>
        </ActionDock>
      </Stack>
    </Narrow>
  );
}
