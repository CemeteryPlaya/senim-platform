import type { Metadata } from "next";
import { Download } from "lucide-react";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Button, buttonClasses, DataTable, Money, PageTitle, Stack, Stat, StatRow, StatusChip, TextField, TextLink } from "@/kit";
import { incomePeriodSchema, incomeReport } from "@/modules/operator";
import { pageHref, requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { flatParams, thisMonth, type SearchParams } from "../_parts/search-params";

const t = ru.app.operatorDeals;
const i = t.income;
const c = i.columns;

export const metadata: Metadata = { title: i.metaTitle };

type Props = { searchParams: Promise<SearchParams> };

/**
 * Доход платформы по схеме 2% + 4% за период — только из журнала денег (`platformIncomeReport`), не из статусов сделок.
 * Период — форма GET (даты в адресе: ссылкой можно поделиться, работает без JavaScript); по умолчанию текущий месяц по
 * Астане. Неверный период — сообщение у поля и отчёт за месяц по умолчанию. Строки — сделки с пометкой «тестовая» у
 * тестовой операции (только оператору); внизу — выгрузка CSV за тот же период.
 */
export default async function IncomePage({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await requireOperator(pageHref("/operator/income", sp));
  const raw = flatParams(sp);
  const fallback = thisMonth();
  const input = { from: raw.from || fallback.from, to: raw.to || fallback.to };
  const parsed = incomePeriodSchema.safeParse(input);
  const shown = parsed.success ? input : fallback;
  const report = await incomeReport(user, parsed.success ? parsed.data : incomePeriodSchema.parse(fallback));
  const csvHref = `${to("/operator/income/csv")}?${new URLSearchParams(shown)}`;

  return (
    <Stack gap="section">
      <PageTitle title={i.title} lead={i.lead} />
      <form method="get" action={to("/operator/income")} noValidate>
        <div className="flex flex-col gap-stack-group desktop:flex-row desktop:flex-wrap desktop:items-end">
          <TextField label={i.from} name="from" type="date" defaultValue={shown.from} />
          <TextField label={i.to} name="to" type="date" defaultValue={shown.to} {...(parsed.success ? {} : { error: i.periodInvalid })} />
          <Button type="submit" variant="secondary">
            {i.apply}
          </Button>
        </div>
      </form>
      <StatRow label={i.title}>
        <Stat compact label={i.protection} value={<Money tiyn={report.protectionTiyn} />} />
        <Stat compact label={i.guarantee} value={<Money tiyn={report.guaranteeTiyn} />} />
        <Stat compact label={i.total} value={<Money tiyn={report.totalTiyn} />} />
      </StatRow>
      <DataTable
        caption={i.byDeal}
        rows={report.rows}
        rowKey={(r) => r.transactionId}
        empty={i.empty}
        columns={[
          {
            key: "deal",
            header: c.deal,
            rowHeader: true,
            width: "narrow",
            cell: (r) => (
              <span className="flex flex-col items-start gap-1">
                <TextLink href={to(`/operator/deals/${encodeURIComponent(r.dealId)}`)}>{t.deal(r.dealNumber)}</TextLink>
                {r.isTest && <StatusChip tone="neutral">{t.testMark}</StatusChip>}
              </span>
            ),
          },
          { key: "settledAt", header: c.settledAt, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.settledAt)}</span> },
          { key: "protection", header: c.protection, numeric: true, cell: (r) => <Money tiyn={r.protectionTiyn} /> },
          { key: "guarantee", header: c.guarantee, numeric: true, cell: (r) => <Money tiyn={r.guaranteeTiyn} /> },
          { key: "total", header: c.total, numeric: true, cell: (r) => <Money tiyn={r.totalTiyn} /> },
        ]}
      />
      <div className="flex flex-wrap items-center gap-3">
        {/* Файл, а не страница: обычная ссылка с download, без клиентской навигации. */}
        <a href={csvHref} download className={buttonClasses({ variant: "secondary" })}>
          <Download aria-hidden className="size-5 shrink-0" />
          {i.csv}
        </a>
        <TextLink href={to("/operator/report")}>{i.toReport}</TextLink>
      </div>
    </Stack>
  );
}
