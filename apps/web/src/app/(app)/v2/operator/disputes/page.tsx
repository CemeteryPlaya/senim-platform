import type { Metadata } from "next";
import { formatDate } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { DataTable, Money, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { listDisputes } from "@/modules/operator";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { disputeTone } from "./dispute-view";

const t = ru.app.operatorDisputes;

export const metadata: Metadata = { title: t.disputes.metaTitle };

/**
 * Споры таблицей: сделка (ссылка в карточку спора), статус и итог, причина, этап сделки при открытии, дата, цена по
 * оферте. Открытые — первыми (порядок задаёт модуль). Раздел из меню: «Назад» не нужно, главной кнопки нет — действие в строке.
 */
export default async function DisputesPage() {
  const user = await requireOperator(to("/operator/disputes"));
  const disputes = await listDisputes(user);
  const c = t.disputes.columns;

  return (
    <Stack gap="section">
      <PageTitle title={t.disputes.title} />
      <DataTable
        caption={t.disputes.title}
        captionHidden
        rows={disputes}
        rowKey={(d) => d.id}
        empty={t.disputes.empty}
        columns={[
          {
            key: "deal",
            header: c.deal,
            rowHeader: true,
            width: "wide",
            cell: (d) => <TextLink href={to(`/operator/disputes/${d.id}`)}>{`${t.deal(d.deal.number)}: ${d.deal.title}`}</TextLink>,
          },
          {
            key: "status",
            header: c.status,
            width: "narrow",
            cell: (d) => (
              <span className="flex flex-col items-start gap-1">
                <StatusChip tone={disputeTone(d.status)}>{t.disputes.status[d.status]}</StatusChip>
                {d.outcome && <span className="text-sub text-muted">{t.disputes.outcomes[d.outcome]}</span>}
              </span>
            ),
          },
          { key: "reason", header: c.reason, width: "narrow", cell: (d) => t.disputes.reasons[d.reason] },
          { key: "openedIn", header: c.openedIn, width: "mid", cell: (d) => t.dealStatus[d.openedInStatus] },
          { key: "openedAt", header: c.openedAt, cell: (d) => <span className="whitespace-nowrap">{formatDate(d.createdAt)}</span> },
          { key: "price", header: c.price, numeric: true, cell: (d) => <Money tiyn={d.deal.priceTiyn} /> },
        ]}
      />
    </Stack>
  );
}
