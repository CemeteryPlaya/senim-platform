import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { listDeals, type DealListItem } from "@/modules/deal-core";
import { getCurrentUser, requireIntroduced, switchRoleHref, type CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { Card, Container, EmptyState, Money, PageHeader, StatusBadge } from "@/ui";
import { DEAL_TONE } from "./_parts/labels";

const t = ru.deal;

export const metadata: Metadata = { title: t.listTitle };

/** Сделка своей роли открывается сразу, другой роли — через переключение роли (ADR-004). */
function dealHref(user: CurrentUser, d: DealListItem): string {
  const path = `/deals/${d.id}`;
  return d.myRole && d.myRole !== user.role ? switchRoleHref(d.myRole, path) : path;
}

/** Список сделок: человек видит свои в обеих ролях (с пометкой, если ролей две), оператор — все. */
export default async function DealsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/deals")}`);
  requireIntroduced(user, "/deals");
  const deals = await listDeals(user);
  const showRole = user.roles.length > 1;

  return (
    <Container size="form">
      <PageHeader title={t.listTitle} back={{ href: "/" }} />
      {deals.length === 0 ? (
        <EmptyState
          icon={<Handshake aria-hidden className="size-8" />}
          title={t.listEmptyTitle}
          description={user.role === "EXECUTOR" ? t.listEmptyExecutor : t.listEmptyClient}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {deals.map((d) => (
            <Card as="li" key={d.id} titleAs="h2" title={t.number(d.number)} description={d.title}>
              <div className="flex flex-col gap-3">
                <StatusBadge tone={DEAL_TONE[d.status]}>{t.status[d.status]}</StatusBadge>
                {showRole && d.myRole && <p className="text-lg font-semibold text-ink">{t.youAre[d.myRole]}</p>}
                <p className="text-lg text-ink">
                  <Money amount={d.totalAmount} /> · {(d.myRole ?? user.role) === "EXECUTOR" ? t.clientLabel : d.executorLabel}
                </p>
                <p className="text-base text-muted">{t.progress(d.closedStages, d.totalStages)}</p>
                <Link
                  href={dealHref(user, d)}
                  className="inline-flex min-h-control-sm items-center self-start rounded-control text-lg font-semibold text-accent underline-offset-4 hover:underline"
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
