import type { Metadata } from "next";
import { ChevronDown, ScrollText, SlidersHorizontal } from "lucide-react";
import { ru } from "@/i18n/ru";
import { auditFilterSchema, searchAudit } from "@/modules/operator";
import { Button, ButtonLink, Container, EmptyState, Input, PageHeader } from "@/ui";
import { AuditList } from "../_components/AuditList";
import { flatParams, requireOperatorPage } from "../_lib/guard";

const t = ru.operator.audit;

export const metadata: Metadata = { title: t.title };

const FIELDS = ["entityType", "entityId", "scope", "action", "actorId", "from", "to"] as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage("/operator/audit");
  const raw = flatParams(await searchParams);
  const parsed = auditFilterSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : {};
  const { events, nextBefore } = await searchAudit(user, filter);

  /** Ссылка на следующую страницу: те же фильтры + курсор по seq. */
  const query = new URLSearchParams();
  for (const key of FIELDS) if (raw[key]) query.set(key, raw[key]);
  const active = FIELDS.filter((key) => raw[key]).length;
  const nextHref = nextBefore ? `/operator/audit?${new URLSearchParams([...query, ["before", nextBefore]])}` : null;

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      <div className="flex flex-col gap-6">
        <details open={active > 0} className="group rounded-card border border-line bg-surface">
          <summary className="flex min-h-control min-w-0 cursor-pointer list-none items-center gap-3 rounded-card px-5 py-3 text-lg font-bold text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal aria-hidden className="size-6 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              {t.filters}
              {active > 0 && <span className="font-normal text-muted"> · {t.filtersActive(active)}</span>}
            </span>
            <ChevronDown aria-hidden className="size-6 shrink-0 text-muted group-open:rotate-180" />
          </summary>
          <form method="get" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 px-5 pt-2 pb-5">
            <Input label={t.entityType} hint={t.entityTypeHint} name="entityType" defaultValue={raw.entityType} />
            <Input label={t.entityId} name="entityId" defaultValue={raw.entityId} />
            <Input label={t.scope} hint={t.scopeHint} name="scope" defaultValue={raw.scope} />
            <Input label={t.action} hint={t.actionHint} name="action" defaultValue={raw.action} />
            <Input label={t.actorId} name="actorId" defaultValue={raw.actorId} />
            <Input label={t.from} name="from" type="date" defaultValue={raw.from} />
            <Input label={t.to} name="to" type="date" defaultValue={raw.to} />
            <div className="col-span-full flex flex-wrap gap-3">
              <Button type="submit">{t.apply}</Button>
              {active > 0 && (
                <ButtonLink href="/operator/audit" variant="ghost">
                  {t.reset}
                </ButtonLink>
              )}
            </div>
          </form>
        </details>

        {events.length === 0 ? (
          <EmptyState icon={<ScrollText />} title={t.empty} description={t.emptyHint} />
        ) : (
          <section aria-label={t.title} className="rounded-card border border-line bg-surface px-5">
            <AuditList events={events} linkScopes />
          </section>
        )}

        <div className="flex flex-wrap gap-3">
          {raw.before && (
            <ButtonLink href={`/operator/audit?${query}`} variant="secondary">
              {t.newest}
            </ButtonLink>
          )}
          {nextHref && (
            <ButtonLink href={nextHref} variant="secondary">
              {t.more}
            </ButtonLink>
          )}
        </div>
      </div>
    </Container>
  );
}
