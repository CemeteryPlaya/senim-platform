import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/i18n/ru";
import { listDisputes } from "@/modules/operator";
import { Container, DateText, EmptyState, Money, PageHeader, StatusBadge } from "@/ui";
import { requireOperatorPage } from "../_lib/guard";

const t = ru.operator.disputes;

export const metadata: Metadata = { title: t.title };

export default async function DisputesPage() {
  const user = await requireOperatorPage("/operator/disputes");
  const disputes = await listDisputes(user);

  return (
    <Container>
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      {disputes.length === 0 ? (
        <EmptyState title={t.empty} description={t.emptyHint} />
      ) : (
        <ul className="rounded-card border border-line bg-surface px-5">
          {disputes.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 border-b border-line py-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/operator/disputes/${d.id}`} className="text-lg font-bold text-ink">
                  {t.deal(d.deal.number)}: {d.deal.title}
                </Link>
                <StatusBadge tone={d.status === "OPEN" ? "danger" : "success"}>{t.status[d.status]}</StatusBadge>
                {d.decision && <StatusBadge tone="neutral">{t.decisions[d.decision]}</StatusBadge>}
              </div>
              <p className="text-base text-ink-soft">
                {t.reasons[d.reason]}
                {d.stage && `, ${d.stage.title}`}
              </p>
              <p className="text-sm text-muted">
                {t.openedAt} <DateText value={d.createdAt} />
                <br />
                <Money amount={d.deal.totalAmount} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
