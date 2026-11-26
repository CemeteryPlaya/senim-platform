import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Card, TextLink } from "@/kit";
import type { AuditView } from "@/modules/operator";
import { to } from "../../../../_shell/paths";
import { actionLabel, auditHref, dealIdOf, describeJson, originLine } from "./audit-view";

const t = ru.app.operatorDeals.audit;

/**
 * Записи журнала от новых к старым: строка «номер · время · роль», действие (название и код), сущность, изменения «до» и
 * «после», откуда (коротко; полный user-agent — по нажатию, `details`). Сущность записи со scope — сама ссылка на всю
 * историю записи; ниже — «Открыть сделку», если сделка есть. Серверный компонент.
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
              <p className="text-sub text-muted">
                <span className="tabular-nums">{t.seq(e.seq)}</span>
                {" · "}
                {formatDateTime(e.createdAt)}
                {" · "}
                {t.roles[e.actorRole] ?? e.actorRole}
              </p>
              <p className="text-body font-medium wrap-anywhere text-ink">
                {actionLabel(e.action)}
                {actionLabel(e.action) !== e.action && <span className="text-sub font-normal text-muted"> ({e.action})</span>}
              </p>
              {e.scope ? (
                <p className="text-sub wrap-anywhere">
                  <TextLink href={auditHref(to("/operator/audit"), { scope: e.scope })}>
                    {t.entity(e.entityType, e.entityId)}
                    <span className="sr-only">, {t.showScope}</span>
                  </TextLink>
                </p>
              ) : (
                <p className="text-sub wrap-anywhere text-muted">{t.entity(e.entityType, e.entityId)}</p>
              )}
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
              {origin &&
                (origin.full ? (
                  <details className="text-sub text-muted">
                    {/* Цель нажатия 48 px — псевдоэлементом на поля строки, сама строка остаётся строкой текста. */}
                    <summary className="relative w-fit cursor-pointer wrap-anywhere before:absolute before:inset-x-0 before:-inset-y-3">{origin.short}</summary>
                    <p className="mt-1 wrap-anywhere">{origin.full}</p>
                  </details>
                ) : (
                  <p className="text-sub wrap-anywhere text-muted">{origin.short}</p>
                ))}
              {dealId && (
                <div>
                  <TextLink href={to(`/operator/deals/${encodeURIComponent(dealId)}`)}>{t.openDeal}</TextLink>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
