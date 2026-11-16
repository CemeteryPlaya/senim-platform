import type { Metadata } from "next";
import { formatDate } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { DataTable, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { listOperatorDeals } from "@/modules/operator";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";

const t = ru.app.operatorDeals;
const c = t.list.columns;

export const metadata: Metadata = { title: t.list.metaTitle };

/** Модуль отдаёт не больше этого числа последних сделок (`listOperatorDeals`): дальше — отчёт и журнал аудита. */
const LIST_LIMIT = 200;

/**
 * Все сделки таблицей: сделка (ссылка в карточку), статус с отметками (спор, операции ждут документа банка, тестовая — только
 * оператору), провайдер оплаты, дата. Новые сверху. Раздел из меню: «Назад» не нужно, главной кнопки нет — действие в строке.
 */
export default async function OperatorDealsPage() {
  const user = await requireOperator(to("/operator/deals"));
  const deals = await listOperatorDeals(user);

  return (
    <Stack gap="section">
      <PageTitle title={t.list.title} lead={deals.length >= LIST_LIMIT ? `${t.list.lead} ${t.list.capped(LIST_LIMIT)}` : t.list.lead} />
      <DataTable
        caption={t.list.title}
        captionHidden
        rows={deals}
        rowKey={(d) => d.id}
        empty={t.list.empty}
        columns={[
          {
            key: "deal",
            header: c.deal,
            rowHeader: true,
            width: "wide",
            cell: (d) => <TextLink href={to(`/operator/deals/${encodeURIComponent(d.id)}`)}>{`${t.deal(d.number)}: ${d.title}`}</TextLink>,
          },
          {
            key: "status",
            header: c.status,
            width: "mid",
            cell: (d) => (
              <span className="flex flex-col items-start gap-1">
                <StatusChip tone="neutral">{t.dealStatus[d.status]}</StatusChip>
                {d.disputeOpen && <StatusChip tone="danger">{t.list.disputeOpen}</StatusChip>}
                {d.pendingOperations > 0 && <StatusChip tone="warn">{t.list.pending(d.pendingOperations)}</StatusChip>}
                {d.isTest && <StatusChip tone="neutral">{t.testMark}</StatusChip>}
              </span>
            ),
          },
          { key: "provider", header: c.provider, width: "narrow", cell: (d) => t.providers[d.provider] },
          { key: "createdAt", header: c.createdAt, cell: (d) => <span className="whitespace-nowrap">{formatDate(d.createdAt)}</span> },
        ]}
      />
    </Stack>
  );
}
