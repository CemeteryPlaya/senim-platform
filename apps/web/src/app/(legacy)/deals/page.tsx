import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { listDeals, type DealListItem } from "@/modules/deal-core";
import { getCurrentUser, requireIntroduced, switchRoleHref, type CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { Card, Container, DealProgress, EmptyState, Money, PageHeader, StatusBadge } from "@/ui";
import { DEAL_TONE } from "./_parts/labels";

const t = ru.deal;

export const metadata: Metadata = { title: t.listTitle };

/** Сделка своей роли открывается сразу, другой роли — через переключение роли (ADR-004). */
function dealHref(user: CurrentUser, d: DealListItem): string {
  const path = `/deals/${d.id}`;
  return d.myRole && d.myRole !== user.role ? switchRoleHref(d.myRole, path) : path;
}

/** Список сделок: карточки с ходом сделки; человек видит свои в обеих ролях (с пометкой, если ролей две), оператор — все. */
export default async function DealsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/deals")}`);
  requireIntroduced(user, "/deals");
  const deals = await listDeals(user);
  const showRole = user.roles.length > 1;

  return (
    <Container>
      <PageHeader title={t.listTitle} back={{ href: "/" }} />
      {deals.length === 0 ? (
        <EmptyState
          icon={<Handshake aria-hidden className="size-8" />}
          title={t.listEmptyTitle}
          description={user.role === "EXECUTOR" ? t.listEmptyExecutor : t.listEmptyClient}
        />
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-10 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
          {deals.map((d) => (
            <Card as="li" key={d.id} titleAs="h2" title={t.number(d.number)} description={d.title}>
              <div className="flex flex-col gap-3">
                <StatusBadge tone={DEAL_TONE[d.status]} className="self-start">
                  {t.status[d.status]}
                </StatusBadge>
                {/* Открытый спор — hasOpenDispute из deal-core, то же правило, что на экране сделки. */}
                <DealProgress status={d.status} hasOpenDispute={d.hasOpenDispute} />
                {showRole && d.myRole && <p className="text-lg font-semibold text-ink">{t.youAre[d.myRole]}</p>}
                <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-base text-muted">{(d.myRole ?? user.role) === "EXECUTOR" ? t.clientLabel : d.executorLabel}</span>
                  <Money amount={d.estimate.totalTiyn} className="text-lg font-bold text-ink" />
                </p>
                <Link
                  href={dealHref(user, d)}
                  className="inline-flex min-h-control-sm items-center self-start rounded-control text-lg font-semibold text-primary underline-offset-4 hover:underline"
                  aria-label={`${t.listOpen}: ${t.number(d.number)}`}
                >
                  {t.listOpen}
                </Link>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </Container>
  );
}
