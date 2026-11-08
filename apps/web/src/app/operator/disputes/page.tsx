import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listDisputes } from "@/modules/operator";
import { Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { DataTable, TD, TD_NUM, TH, TH_ROW } from "../_components/DataTable";
import { requireOperatorPage } from "../_lib/guard";

const t = ru.operator.disputes;
const col = t.columns;

export const metadata: Metadata = { title: t.title };

/** Споры таблицей: сделка (ссылка в спор), статус и итог, причина, этап при открытии, дата, цена по оферте. */
export default async function DisputesPage() {
  const user = await requireOperatorPage("/operator/disputes");
  const disputes = await listDisputes(user);

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      {disputes.length === 0 ? (
        <EmptyState icon={<Scale />} title={t.empty} description={t.emptyHint} />
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
                {col.reason}
              </th>
              <th scope="col" className={TH}>
                {col.openedIn}
              </th>
              <th scope="col" className={TH}>
                {col.openedAt}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                {col.price}
              </th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((d) => (
              <tr key={d.id}>
                <th scope="row" className={`${TH_ROW} min-w-56`}>
                  <Link href={`/operator/disputes/${d.id}`} className="font-semibold break-words text-primary underline">
                    {`${t.deal(d.deal.number)}: ${d.deal.title}`}
                  </Link>
                </th>
                <td className={`${TD} min-w-40`}>
                  <span className="flex flex-wrap gap-2">
                    <StatusBadge tone={d.status === "OPEN" ? "danger" : "success"}>{t.status[d.status]}</StatusBadge>
                    {d.outcome && <StatusBadge tone="neutral">{t.outcomes[d.outcome]}</StatusBadge>}
                  </span>
                </td>
                <td className={`${TD} min-w-36 text-ink-soft`}>{t.reasons[d.reason]}</td>
                <td className={`${TD} min-w-44 text-ink-soft`}>{ru.operator.dealStatus[d.openedInStatus]}</td>
                <td className={`${TD} whitespace-nowrap text-ink-soft`}>
                  <DateText value={d.createdAt} />
                </td>
                <td className={`${TD_NUM} font-semibold`}>{formatTiyn(d.deal.priceTiyn)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Container>
  );
}
