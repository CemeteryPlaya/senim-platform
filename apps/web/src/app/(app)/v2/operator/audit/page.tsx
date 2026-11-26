import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Button, ButtonLink, EmptyState, Notice, PageTitle, Stack, TextField } from "@/kit";
import { auditFilterSchema, searchAudit } from "@/modules/operator";
import { pageHref, requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { flatParams, type SearchParams } from "../_parts/search-params";
import { AuditList } from "./_parts/AuditList";
import { AUDIT_FIELDS, auditHref } from "./_parts/audit-view";

const t = ru.app.operatorDeals.audit;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<SearchParams> };

/**
 * Журнал аудита: форма GET с восемью фильтрами (сделка по номеру, сущность и её id, история scope, действие по началу кода,
 * автор, даты), записи от новых к старым по 50, следующая страница — курсор `before` (seq последней записи). Всё состояние
 * в адресе: ссылкой можно поделиться, работает без JavaScript. Фильтры, которые не разобрались (номер сделки не число,
 * неверная дата), не применяются — об этом сказано над списком. Журнал только читается, главной кнопки нет.
 */
export default async function AuditPage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await requireOperator(pageHref("/operator/audit", sp));
  const raw = flatParams(sp);
  const parsed = auditFilterSchema.safeParse(raw);
  const { events, nextBefore } = await searchAudit(user, parsed.success ? parsed.data : {});
  const active = AUDIT_FIELDS.filter((field) => raw[field]).length;
  const base = to("/operator/audit");

  return (
    <Stack gap="section">
      <PageTitle title={t.title} />
      <details open={active > 0 || !parsed.success} className="group rounded-card bg-surface">
        <summary className="flex min-h-control cursor-pointer list-none items-center gap-2 rounded-card px-card py-3 text-headline text-ink [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            {t.filters}
            {active > 0 && <span className="text-body font-normal text-muted">, {t.filtersActive(active)}</span>}
          </span>
          <span aria-hidden className="text-muted group-open:rotate-180">
            ▾
          </span>
        </summary>
        <form method="get" action={base} noValidate className="flex flex-col gap-stack-group px-card pt-1 pb-card">
          <div className="grid grid-cols-1 gap-stack-group desktop:grid-cols-2">
            <TextField label={t.deal} name="deal" inputMode="numeric" defaultValue={raw.deal ?? ""} />
            <TextField label={t.entityType} name="entityType" defaultValue={raw.entityType ?? ""} />
            <TextField label={t.entityId} name="entityId" defaultValue={raw.entityId ?? ""} />
            <TextField label={t.scope} name="scope" defaultValue={raw.scope ?? ""} />
            <TextField label={t.action} name="action" defaultValue={raw.action ?? ""} />
            <TextField label={t.actorId} name="actorId" defaultValue={raw.actorId ?? ""} />
            <TextField label={t.from} name="from" type="date" defaultValue={raw.from ?? ""} />
            <TextField label={t.to} name="to" type="date" defaultValue={raw.to ?? ""} />
          </div>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sub text-muted">
            {(
              [
                [t.deal, t.dealHint],
                [t.entityType, t.entityTypeHint],
                [t.scope, t.scopeHint],
                [t.action, t.actionHint],
              ] as const
            ).map(([label, hint]) => (
              <li key={label}>
                <span className="text-ink">{label}</span>
                {" — "}
                {hint}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary">
              {t.apply}
            </Button>
            {active > 0 && (
              <ButtonLink href={base} variant="quiet">
                {t.reset}
              </ButtonLink>
            )}
          </div>
        </form>
      </details>

      {!parsed.success && <Notice tone="warn">{t.invalid}</Notice>}

      {events.length === 0 ? <EmptyState title={t.empty.title} body={t.empty.body} /> : <AuditList events={events} />}

      {(raw.before || nextBefore) && (
        <div className="flex flex-wrap gap-3">
          {raw.before && (
            <ButtonLink href={auditHref(base, raw)} variant="secondary">
              {t.newest}
            </ButtonLink>
          )}
          {nextBefore && (
            <ButtonLink href={auditHref(base, raw, nextBefore)} variant="secondary">
              {t.more}
            </ButtonLink>
          )}
        </div>
      )}
    </Stack>
  );
}
