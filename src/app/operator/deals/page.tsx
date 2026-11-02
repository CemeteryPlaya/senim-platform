import type { Metadata } from "next";
import { Handshake } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listOperatorDeals } from "@/modules/operator";
import { Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";
import { LIST_GRID, ListCard } from "../_components/ListCard";
import { requireOperatorPage } from "../_lib/guard";

const o = ru.operator;
const t = o.deals;

export const metadata: Metadata = { title: t.title };

export default async function OperatorDealsPage() {
  const user = await requireOperatorPage("/operator/deals");
  const deals = await listOperatorDeals(user);

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} back={{ href: "/operator", label: o.backToPanel }} />
      {deals.length === 0 ? (
        <EmptyState icon={<Handshake />} title={t.empty} description={t.emptyHint} />
      ) : (
        <ul className={LIST_GRID}>
          {deals.map((d) => (
            <ListCard
              key={d.id}
              titleAs="h2"
              href={`/operator/deals/${d.id}`}
              title={`${t.card.title(d.number)}: ${d.title}`}
              badges={
                <>
                  <StatusBadge tone="info">{o.dealStatus[d.status]}</StatusBadge>
                  {d.disputeOpen && <StatusBadge tone="danger">{t.disputeOpen}</StatusBadge>}
                  {d.pendingOperations > 0 && <StatusBadge tone="warning">{t.pending(d.pendingOperations)}</StatusBadge>}
                  {d.isDemo && <StatusBadge tone="neutral">{o.testMark}</StatusBadge>}
                </>
              }
              meta={[o.providers[d.provider], <DateText key="at" value={d.createdAt} />]}
            />
          ))}
        </ul>
      )}
    </Container>
  );
}
