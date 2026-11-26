import type { Metadata } from "next";
import { Download } from "lucide-react";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Button, buttonClasses, Card, Money, PageTitle, Section, Stack, Stat, StatRow, TextField, TextLink } from "@/kit";
import { buildReport, CSV_KINDS, reportSchema } from "@/modules/operator";
import { pageHref, requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { TableOrCards } from "../_parts/TableOrCards";
import { flatParams, type SearchParams } from "../_parts/search-params";

const t = ru.app.operatorDeals;
const r = t.report;

export const metadata: Metadata = { title: r.metaTitle };

type Props = { searchParams: Promise<SearchParams> };

type Row = { key: string; label: string; count: number; sumTiyn: bigint };

/**
 * Таблица «что — сколько — на какую сумму» с итогом внизу; на узком окне прокручивается в своей области. Телефон — одна
 * карточка со строками «статус — 4 — 2 755 000 ₸» (`compact`): подписи столбцов только для диктора.
 */
function Totals({ caption, head, rows, empty }: { caption: string; head: string; rows: Row[]; empty: { title: string; body: string } }) {
  const total = rows.reduce((acc, row) => ({ count: acc.count + row.count, sum: acc.sum + row.sumTiyn }), { count: 0, sum: 0n });
  return (
    <TableOrCards
      compact
      caption={caption}
      captionHidden
      rows={rows}
      rowKey={(row) => row.key}
      empty={empty}
      columns={[
        { key: "label", header: head, rowHeader: true, cell: (row) => row.label },
        { key: "count", header: r.columns.count, numeric: true, cell: (row) => row.count },
        { key: "sum", header: r.columns.sum, numeric: true, cell: (row) => <Money tiyn={row.sumTiyn} /> },
      ]}
      footer={{ label: r.total, count: total.count, sum: <Money tiyn={total.sum} /> }}
    />
  );
}

/**
 * Отчёт оператора из журнала денег: сводка, сделки по статусам, операции по типам и статусам, расхождения (операции manual,
 * которые ждут документа банка дольше N дней — число дней в адресе), выгрузки CSV. Суммы — тиыны через `Money`. Главной
 * кнопки нет: экран чтения, действия — пересчёт и выгрузки.
 */
export default async function ReportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await requireOperator(pageHref("/operator/report", sp));
  const parsed = reportSchema.safeParse(flatParams(sp));
  const staleDays = parsed.success ? parsed.data.staleDays : 3;
  const report = await buildReport(user, { staleDays });
  const deals = report.deals.reduce((acc, row) => ({ count: acc.count + row.count, sum: acc.sum + row.sumTiyn }), { count: 0, sum: 0n });
  const d = r.discrepancyColumns;

  return (
    <Stack gap="section">
      <PageTitle title={r.title} />
      <StatRow label={r.stats}>
        <Stat label={r.statDeals} value={deals.count} />
        <Stat label={r.statDiscrepancies} value={report.discrepancies.length} muted={report.discrepancies.length === 0} />
        <Stat compact label={r.statPrice} value={<Money tiyn={deals.sum} />} />
      </StatRow>

      <div className="flex min-w-0 flex-col gap-stack-section desktop:grid desktop:grid-cols-2 desktop:items-start desktop:gap-split">
        <Section title={r.dealsByStatus} id="deals">
          <Totals
            caption={r.dealsByStatus}
            empty={r.emptyTotals}
            head={r.columns.status}
            rows={report.deals.map((row) => ({ key: row.status, label: t.dealStatus[row.status], count: row.count, sumTiyn: row.sumTiyn }))}
          />
        </Section>
        <Section title={r.operations} id="operations">
          <Totals
            caption={r.operations}
            empty={r.emptyTotals}
            head={r.columns.type}
            rows={report.operations.map((row) => ({
              key: `${row.type}-${row.status}`,
              label: r.operationLabel(t.moneyTypes[row.type], t.moneyStatus[row.status]),
              count: row.count,
              sumTiyn: row.sumTiyn,
            }))}
          />
        </Section>
      </div>

      <Section title={r.discrepancies} id="discrepancies">
        <p className="text-body text-muted desktop:max-w-measure">{r.discrepanciesHint}</p>
        <form method="get" action={to("/operator/report")} noValidate>
          <div className="flex flex-col gap-stack-group desktop:flex-row desktop:items-end">
            <TextField
              label={r.staleDaysLabel}
              name="staleDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              defaultValue={staleDays}
              {...(parsed.success ? {} : { error: r.staleDaysInvalid })}
            />
            <Button type="submit" variant="secondary">
              {r.apply}
            </Button>
          </div>
        </form>
        <TableOrCards
          caption={r.discrepancies}
          captionHidden
          rows={report.discrepancies}
          rowKey={(row) => row.transactionId}
          empty={r.discrepanciesEmpty}
          // Телефон: операция, сколько ждёт и сумма; точная дата создания — в таблице компьютера и в карточке сделки.
          phoneKeys={["type", "waiting", "amount"]}
          columns={[
            {
              key: "deal",
              header: d.deal,
              rowHeader: true,
              width: "wide",
              cell: (row) => <TextLink href={to(`/operator/deals/${encodeURIComponent(row.dealId)}`)}>{`${t.deal(row.dealNumber)}: ${row.dealTitle}`}</TextLink>,
            },
            { key: "type", header: d.type, width: "mid", cell: (row) => t.moneyTypes[row.type] },
            { key: "createdAt", header: d.createdAt, cell: (row) => <span className="whitespace-nowrap">{formatDateTime(row.createdAt)}</span> },
            { key: "waiting", header: d.waiting, cell: (row) => <span className="whitespace-nowrap">{r.waiting(row.daysWaiting)}</span> },
            { key: "amount", header: d.amount, numeric: true, cell: (row) => <Money tiyn={row.amountTiyn} /> },
          ]}
        />
      </Section>

      <Section title={r.downloads} id="downloads">
        <p className="text-body text-muted desktop:max-w-measure">{r.downloadsHint}</p>
        <Card>
          <div className="flex flex-wrap gap-3">
            {CSV_KINDS.map((kind) => (
              // Файл, а не страница: обычная ссылка с download, без клиентской навигации.
              <a key={kind} href={`${to("/operator/report/csv")}?kind=${kind}&staleDays=${staleDays}`} download className={buttonClasses({ variant: "secondary" })}>
                <Download aria-hidden className="size-5 shrink-0" />
                {r.csvKinds[kind]}
              </a>
            ))}
          </div>
        </Card>
        <TextLink href={to("/operator/income")}>{r.toIncome}</TextLink>
      </Section>
    </Stack>
  );
}
