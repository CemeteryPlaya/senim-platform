import type { Metadata } from "next";
import { Download } from "lucide-react";
import Link from "next/link";
import { ru } from "@/i18n/ru";
import { incomePeriodSchema, incomeReport } from "@/modules/operator";
import { Button, buttonClasses, Container, DateText, EmptyState, Input, PageHeader, StatTiles, StatusBadge } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { COL_NARROW, DataTable, TD, TD_NUM, TH, TH_ROW } from "../_components/DataTable";
import { flatParams, requireOperatorPage } from "../_lib/guard";

const o = ru.operator;
const t = o.income;

export const metadata: Metadata = { title: t.title };

/** Текущий месяц по Астане: с первого числа по сегодня. */
function thisMonth(): { from: string; to: string } {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty" }).format(new Date());
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** Доход платформы по схеме 2% + 4% за период — только из журнала денег (payments.platformIncomeReport). */
export default async function IncomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage("/operator/income");
  const sp = flatParams(await searchParams);
  const fallback = thisMonth();
  const input = { from: sp.from || fallback.from, to: sp.to || fallback.to };
  const parsed = incomePeriodSchema.safeParse(input);
  const shown = parsed.success ? input : fallback;
  const report = await incomeReport(user, parsed.success ? parsed.data : incomePeriodSchema.parse(fallback));
  const csvHref = `/operator/income/csv?${new URLSearchParams(shown).toString()}`;

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: o.backToPanel }} />
      <div className="flex flex-col gap-8">
        <form method="get" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end sm:p-5">
          <Input label={t.from} name="from" type="date" defaultValue={shown.from} error={parsed.success ? undefined : o.validation.period} />
          <Input label={t.to} name="to" type="date" defaultValue={shown.to} />
          <Button type="submit" variant="secondary">
            {t.apply}
          </Button>
        </form>

        <StatTiles
          label={t.title}
          items={[
            { label: t.protection, value: formatTiyn(report.protectionTiyn) },
            { label: t.guarantee, value: formatTiyn(report.guaranteeTiyn) },
            { label: t.total, value: formatTiyn(report.totalTiyn) },
          ]}
        />

        {report.rows.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <DataTable caption={t.byDeal}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  {t.dealColumn}
                </th>
                <th scope="col" className={TH}>
                  {t.settledAt}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t.protection}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t.guarantee}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t.total}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.transactionId}>
                  <th scope="row" className={`${TH_ROW} ${COL_NARROW}`}>
                    <span className="flex flex-col items-start gap-1">
                      <Link href={`/operator/deals/${r.dealId}`} className="font-semibold text-primary underline">
                        {t.deal(r.dealNumber)}
                      </Link>
                      {r.isTest && <StatusBadge tone="neutral">{t.testMark}</StatusBadge>}
                    </span>
                  </th>
                  <td className={`${TD} whitespace-nowrap text-ink-soft`}>
                    <DateText value={r.settledAt} format="dateTime" />
                  </td>
                  <td className={TD_NUM}>{formatTiyn(r.protectionTiyn)}</td>
                  <td className={TD_NUM}>{formatTiyn(r.guaranteeTiyn)}</td>
                  <td className={`${TD_NUM} font-bold`}>{formatTiyn(r.totalTiyn)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        <a href={csvHref} className={buttonClasses({ variant: "secondary", className: "self-start" })} download>
          <Download aria-hidden className="size-5" />
          {t.csv}
        </a>
      </div>
    </Container>
  );
}
