import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Card, StatusChip, TextLink } from "@/kit";
import type { AuditView } from "@/modules/operator";
import { to } from "../../../../_shell/paths";
import { actionLabel, auditHref, dealIdOf, describeJson, originLine } from "./audit-view";

const t = ru.app.operatorDeals.audit;

/**
 * Записи журнала от новых к старым: номер, время, роль автора, действие (название и код), сущность, изменения «до» и
 * «после», откуда. Ссылки: на сделку записи (если она есть) и на всю историю её scope. Серверный компонент.
 */
export function AuditList({ events }: { events: readonly AuditView[] }) {
  return (
    <Card>
      <ol aria-label={t.listLabel} className="flex flex-col">
        {events.map((e) => {
          const before = describeJson(e.before);
          const after = describeJson(e.after);
          const meta = describeJson(e.meta);
          const origin = originLine(e);
          const dealId = dealIdOf(e);
          return (
            <li key={e.seq} className="flex min-w-0 flex-col gap-1 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sub text-muted">
                <span className="tabular-nums">{t.seq(e.seq)}</span>
                <span>{formatDateTime(e.createdAt)}</span>
                <StatusChip tone="neutral">{t.roles[e.actorRole] ?? e.actorRole}</StatusChip>
              </div>
              <p className="text-body font-medium wrap-anywhere text-ink">
                {actionLabel(e.action)}
                {actionLabel(e.action) !== e.action && <span className="text-sub font-normal text-muted"> ({e.action})</span>}
              </p>
              <p className="text-sub wrap-anywhere text-muted">{t.entity(e.entityType, e.entityId)}</p>
              {(before || after) && (
                <dl className="m-0 flex flex-col gap-0.5 text-sub">
                  {before && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted">{t.before}</dt>
                      <dd className="m-0 min-w-0 wrap-anywhere text-ink">{before}</dd>
                    </div>
                  )}
                  {after && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted">{t.after}</dt>
                      <dd className="m-0 min-w-0 wrap-anywhere text-ink">{after}</dd>
                    </div>
                  )}
                </dl>
              )}
              {meta && <p className="text-sub wrap-anywhere text-ink">{meta}</p>}
              {origin && <p className="text-sub wrap-anywhere text-muted">{origin}</p>}
              {(dealId || e.scope) && (
                <div className="flex flex-wrap gap-x-4">
                  {dealId && <TextLink href={to(`/operator/deals/${encodeURIComponent(dealId)}`)}>{t.openDeal}</TextLink>}
                  {e.scope && <TextLink href={auditHref(to("/operator/audit"), { scope: e.scope })}>{t.showScope}</TextLink>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
