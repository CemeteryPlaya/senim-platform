import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { auditFilterSchema, searchAudit } from "@/modules/operator";
import { Button, ButtonLink, Card, Container, EmptyState, Input, PageHeader } from "@/ui";
import { AuditList } from "../_components/AuditList";
import { flatParams, requireOperatorPage } from "../_lib/guard";

const t = ru.operator.audit;

export const metadata: Metadata = { title: t.title };

const FIELDS = ["entityType", "entityId", "scope", "action", "actorId", "from", "to"] as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage();
  const raw = flatParams(await searchParams);
  const parsed = auditFilterSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : {};
  const { events, nextBefore } = await searchAudit(user, filter);

  /** Ссылка на следующую страницу: те же фильтры + курсор по seq. */
  const query = new URLSearchParams();
  for (const key of FIELDS) if (raw[key]) query.set(key, raw[key]);
  const nextHref = nextBefore ? `/operator/audit?${new URLSearchParams([...query, ["before", nextBefore]])}` : null;

  return (
    <Container>
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      <div className="flex flex-col gap-6">
        <Card title={t.filters}>
          <form method="get" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input label={t.entityType} hint={t.entityTypeHint} name="entityType" defaultValue={raw.entityType} />
            <Input label={t.entityId} name="entityId" defaultValue={raw.entityId} />
            <Input label={t.scope} hint={t.scopeHint} name="scope" defaultValue={raw.scope} />
            <Input label={t.action} hint={t.actionHint} name="action" defaultValue={raw.action} />
            <Input label={t.actorId} name="actorId" defaultValue={raw.actorId} />
            <div className="grid grid-cols-2 gap-3">
              <Input label={t.from} name="from" type="date" defaultValue={raw.from} />
              <Input label={t.to} name="to" type="date" defaultValue={raw.to} />
            </div>
            <div className="flex flex-wrap gap-3 sm:col-span-2 lg:col-span-3">
              <Button type="submit">{t.apply}</Button>
              <ButtonLink href="/operator/audit" variant="ghost">
                {t.reset}
              </ButtonLink>
            </div>
          </form>
        </Card>

        {events.length === 0 ? (
          <EmptyState title={t.empty} description={t.emptyHint} />
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
