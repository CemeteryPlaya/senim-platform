import type { Metadata } from "next";
import Link from "next/link";
import { Handshake } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listOperatorDeals } from "@/modules/operator";
import { Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";
import { COL_MID, COL_NARROW, COL_WIDE, DataTable, TD, TH, TH_ROW } from "../_components/DataTable";
import { requireOperatorPage } from "../_lib/guard";

const o = ru.operator;
const t = o.deals;
const col = t.columns;

export const metadata: Metadata = { title: t.title };

/** Все сделки таблицей (десктоп-первый экран): сделка, статус и отметки, провайдер оплаты, дата. */
export default async function OperatorDealsPage() {
  const user = await requireOperatorPage("/operator/deals");
  const deals = await listOperatorDeals(user);

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} back={{ href: "/operator", label: o.backToPanel }} />
      {deals.length === 0 ? (
        <EmptyState icon={<Handshake />} title={t.empty} description={t.emptyHint} />
      ) : (
        <DataTable caption={t.title} hideCaption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                {col.deal}
              </th>
              <th scope="col" className={TH}>
                {col.status}
              </th>
              <th scope="col" className={TH}>
                {col.provider}
              </th>
              <th scope="col" className={TH}>
                {col.createdAt}
              </th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id}>
                <th scope="row" className={`${TH_ROW} ${COL_WIDE}`}>
                  <Link href={`/operator/deals/${d.id}`} className="font-semibold break-words text-primary underline">
                    {`${t.card.title(d.number)}: ${d.title}`}
                  </Link>
                </th>
                <td className={`${TD} ${COL_MID}`}>
                  <span className="flex flex-wrap gap-2">
                    <StatusBadge tone="info">{o.dealStatus[d.status]}</StatusBadge>
                    {d.disputeOpen && <StatusBadge tone="danger">{t.disputeOpen}</StatusBadge>}
                    {d.pendingOperations > 0 && <StatusBadge tone="warning">{t.pending(d.pendingOperations)}</StatusBadge>}
                    {d.isDemo && <StatusBadge tone="neutral">{o.testMark}</StatusBadge>}
                  </span>
                </td>
                <td className={`${TD} text-ink-soft ${COL_NARROW}`}>{o.providers[d.provider]}</td>
                <td className={`${TD} whitespace-nowrap text-ink-soft`}>
                  <DateText value={d.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Container>
  );
}
