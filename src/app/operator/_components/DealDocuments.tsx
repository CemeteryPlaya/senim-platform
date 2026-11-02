import { ru } from "@/i18n/ru";
import type { DealDocument } from "@/modules/operator";
import { DateText, StatusBadge } from "@/ui";

const t = ru.operator.documents;

/** Подписи документа: ЭЦП (проверена ли, тот ли хэш) и собственноручные (хэш, время, IP). */
function Signatures({ doc }: { doc: DealDocument }) {
  if (doc.signatures.length === 0 && doc.handSignatures.length === 0) return <p className="text-sm text-muted">{t.noSignatures}</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {doc.signatures.map((s) => (
        <li key={`ecp-${s.party}`} className="flex flex-col">
          <span className="text-ink">
            {t.parties[s.party]}, {t.methods[s.method]}, <DateText value={s.signedAt} format="dateTime" />
          </span>
          <span className="break-words text-ink-soft">{s.certSubject}</span>
          <span className={s.signedSha256 === doc.sha256 ? "text-ink-soft" : "text-danger"}>{s.signedSha256 === doc.sha256 ? t.hashMatches : t.hashDiffers}</span>
          <span className={s.verified ? "text-success" : "text-danger"}>{s.verified ? t.verified : t.notVerified}</span>
        </li>
      ))}
      {doc.handSignatures.map((h) => (
        <li key={`hand-${h.party}`} className="flex flex-col">
          <span className="text-ink">
            {t.parties[h.party]}, {h.typedName ? t.typed(h.typedName) : t.hand}, <DateText value={h.signedAt} format="dateTime" />
          </span>
          <span className={h.documentSha256 === doc.sha256 ? "text-ink-soft" : "text-danger"}>
            {h.documentSha256 === doc.sha256 ? t.hashMatches : t.hashDiffers}
            {h.ip && `, ${t.ip(h.ip)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Документы сделки с хэшами SHA-256, версиями и подписями; PDF — по маршруту documents. */
export function DealDocuments({ documents }: { documents: readonly DealDocument[] }) {
  if (documents.length === 0) return <p className="text-base text-muted">{ru.operator.deals.card.documentsEmpty}</p>;
  return (
    <ul className="flex flex-col">
      {documents.map((d) => (
        <li key={d.id} className="flex min-w-0 flex-col gap-2 border-b border-line py-3 last:border-b-0">
          <p className="flex flex-wrap items-center gap-2">
            <a href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
              {t.kinds[d.kind]} {d.number}
            </a>
            <span className="text-sm text-muted">{t.version(d.version)}</span>
            <StatusBadge tone={d.status === "SIGNED" ? "success" : "neutral"}>{t.status[d.status]}</StatusBadge>
          </p>
          <p className="text-sm break-all text-ink-soft">
            {t.hash}: {d.sha256}
          </p>
          <Signatures doc={d} />
        </li>
      ))}
    </ul>
  );
}
