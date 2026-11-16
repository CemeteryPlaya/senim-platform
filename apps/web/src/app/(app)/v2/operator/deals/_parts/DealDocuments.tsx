import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Card, StatusChip, TextLink } from "@/kit";
import type { DealDocument } from "@/modules/operator";
import { documentPdfHref } from "../../../deals/[id]/money/money-view";
import { signatureLines } from "./deal-view";

const t = ru.app.operatorDeals;
const d = t.documents;

/** Подписи документа: кто, как, когда; несовпадение хэша и непроверенная ЭЦП — отдельной строкой danger-цвета. */
function Signatures({ doc }: { doc: DealDocument }) {
  const lines = signatureLines(doc);
  if (lines.length === 0) return <p className="text-sub text-muted">{d.noSignatures}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => (
        <li key={line.key} className="flex flex-col text-sub">
          <span className="text-ink">{line.text}</span>
          <span className={line.mismatch ? "wrap-anywhere text-danger" : "wrap-anywhere text-muted"}>{line.detail.join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Документы сделки с версиями, статусом, хэшем SHA-256 и подписями; PDF — обработчик маршрута documents (внешняя ссылка:
 * в новой вкладке, без перехода роутера). Серверный компонент.
 */
export function DealDocuments({ documents }: { documents: readonly DealDocument[] }) {
  if (documents.length === 0) {
    return (
      <Card>
        <p className="text-body text-muted">{t.card.documentsEmpty}</p>
      </Card>
    );
  }
  return (
    <Card>
      <ul className="flex flex-col gap-5">
        {documents.map((doc) => (
          <li key={doc.id} className="flex min-w-0 flex-col gap-2 border-b border-line pb-5 last:border-b-0 last:pb-0">
            <TextLink href={documentPdfHref(doc.id)} external>
              {d.open(d.kinds[doc.kind], doc.number)}
            </TextLink>
            <div className="flex flex-wrap items-center gap-2 text-sub text-muted">
              <StatusChip tone={doc.status === "SIGNED" ? "accent" : "neutral"}>{d.status[doc.status]}</StatusChip>
              <span>{d.version(doc.version)}</span>
              <span>{formatDateTime(doc.createdAt)}</span>
            </div>
            <p className="text-sub wrap-anywhere text-muted">
              {d.hash}: {doc.sha256}
            </p>
            <Signatures doc={doc} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
