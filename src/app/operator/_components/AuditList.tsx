import Link from "next/link";
import { ru } from "@/i18n/ru";
import type { AuditView } from "@/modules/operator";
import { DateText, StatusBadge } from "@/ui";

const t = ru.operator.audit;
const actionLabel = (code: string) => t.actions[code] ?? ru.deal.history.action[code] ?? code;

/** Значение до/после в одну строку: {"status":"APPROVED"} → status: APPROVED. */
export function describeJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(describeJson).join(", ");
  return Object.entries(value)
    .map(([k, v]) => `${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

/** Записи журнала: номер, время, автор, действие, сущность, изменения. Общий для журнала, споров и показа банку. */
export function AuditList({ events, linkScopes = false }: { events: AuditView[]; linkScopes?: boolean }) {
  return (
    <ol className="flex flex-col">
      {events.map((e) => {
        const before = describeJson(e.before);
        const after = describeJson(e.after);
        const meta = describeJson(e.meta);
        return (
          <li key={e.seq} className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm text-muted tabular-nums">
                {t.seq}
                {e.seq}
              </span>
              <DateText value={e.createdAt} format="dateTime" className="text-sm text-muted" />
              <StatusBadge tone="neutral">{t.roles[e.actorRole] ?? e.actorRole}</StatusBadge>
            </div>
            <p className="font-semibold break-words text-ink">
              {actionLabel(e.action)} <span className="text-sm font-normal text-muted">({e.action})</span>
            </p>
            <p className="text-sm break-all text-ink-soft">
              {e.entityType}: {e.entityId}
              {linkScopes && e.scope && (
                <>
                  {" "}
                  <Link href={`/operator/audit?scope=${encodeURIComponent(e.scope)}`} className="text-primary underline">
                    {t.showScope}
                  </Link>
                </>
              )}
            </p>
            {(before || after) && (
              <dl className="facts gap-x-3 text-sm">
                {before && (
                  <>
                    <dt className="text-muted">{t.before}</dt>
                    <dd className="break-words text-ink-soft">{before}</dd>
                  </>
                )}
                {after && (
                  <>
                    <dt className="text-muted">{t.after}</dt>
                    <dd className="break-words text-ink-soft">{after}</dd>
                  </>
                )}
              </dl>
            )}
            {meta && <p className="text-sm break-words text-ink-soft">{meta}</p>}
          </li>
        );
      })}
    </ol>
  );
}
