import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listDisputes } from "@/modules/operator";
import { Container, DateText, EmptyState, Money, PageHeader, StatusBadge } from "@/ui";
import { LIST_GRID, ListCard } from "../_components/ListCard";
import { requireOperatorPage } from "../_lib/guard";

const t = ru.operator.disputes;

export const metadata: Metadata = { title: t.title };

export default async function DisputesPage() {
  const user = await requireOperatorPage("/operator/disputes");
  const disputes = await listDisputes(user);

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      {disputes.length === 0 ? (
        <EmptyState icon={<Scale />} title={t.empty} description={t.emptyHint} />
      ) : (
        <ul className={LIST_GRID}>
          {disputes.map((d) => (
            <ListCard
              key={d.id}
              titleAs="h2"
              href={`/operator/disputes/${d.id}`}
              title={`${t.deal(d.deal.number)}: ${d.deal.title}`}
              badges={
                <>
                  <StatusBadge tone={d.status === "OPEN" ? "danger" : "success"}>{t.status[d.status]}</StatusBadge>
                  {d.decision && <StatusBadge tone="neutral">{t.decisions[d.decision]}</StatusBadge>}
                </>
              }
              meta={[
                d.stage ? `${t.reasons[d.reason]}, ${d.stage.title}` : t.reasons[d.reason],
                <>
                  {t.openedAt} <DateText value={d.createdAt} />
                </>,
              ]}
              aside={<Money amount={d.deal.totalAmount} />}
            />
          ))}
        </ul>
      )}
    </Container>
  );
}
