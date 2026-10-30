import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { listDeals } from "@/modules/deal-core";
import { getCurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { Card, Container, EmptyState, Money, PageHeader, StatusBadge } from "@/ui";
import { DEAL_TONE } from "./_parts/labels";

const t = ru.deal;

export const metadata: Metadata = { title: t.listTitle };

/** Список сделок: заказчик и исполнитель видят свои, оператор — все. */
export default async function DealsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/deals")}`);
  const deals = await listDeals(user);

  return (
    <Container size="form">
      <PageHeader title={t.listTitle} description={t.listDescription} back={{ href: "/" }} />
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
                <p className="text-lg text-ink">
                  <Money amount={d.totalAmount} /> · {user.role === "CLIENT" ? d.executorLabel : t.clientLabel}
                </p>
                <p className="text-base text-muted">{t.progress(d.closedStages, d.totalStages)}</p>
                <Link
                  href={`/deals/${d.id}`}
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
