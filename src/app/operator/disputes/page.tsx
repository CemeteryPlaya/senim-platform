import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listDisputes } from "@/modules/operator";
import { Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";
import { formatTiyn } from "@/ui/format";
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
                  {d.outcome && <StatusBadge tone="neutral">{t.outcomes[d.outcome]}</StatusBadge>}
                </>
              }
              meta={[
                t.reasons[d.reason],
                t.openedIn(ru.operator.dealStatus[d.openedInStatus].toLowerCase()),
                <>
                  {t.openedAt} <DateText value={d.createdAt} />
                </>,
              ]}
              aside={formatTiyn(d.deal.priceTiyn)}
            />
          ))}
        </ul>
      )}
    </Container>
  );
}
