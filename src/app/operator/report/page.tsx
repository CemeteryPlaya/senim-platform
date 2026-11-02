import type { Metadata } from "next";
import { Download, Handshake, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { buildReport, CSV_KINDS, reportSchema } from "@/modules/operator";
import { Alert, Button, buttonClasses, Card, Container, DateText, Input, PageHeader, SectionTitle, Stat } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { LIST_GRID, ListCard } from "../_components/ListCard";
import { flatParams, requireOperatorPage } from "../_lib/guard";

const o = ru.operator;
const t = o.report;

export const metadata: Metadata = { title: t.title };

type Row = { key: string; label: ReactNode; count: number; sumTiyn: bigint };

/** Таблица «что — сколько — на какую сумму» с итогом; на узком экране прокручивается в своей области. */
function Totals({ title, head, rows }: { title: string; head: string; rows: Row[] }) {
  const total = rows.reduce((acc, r) => ({ count: acc.count + r.count, sum: acc.sum + r.sumTiyn }), { count: 0, sum: 0n });
  return (
    <Card title={title}>
      <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label={ru.common.ui.tableRegion(title)}>
        <table className="w-full text-left text-base">
          <thead className="text-sm text-muted">
            <tr>
              <th scope="col" className="pb-2 font-semibold">
                {head}
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                {t.count}
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                {t.sum}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 font-normal">
                  {r.label}
                </th>
                <td className="py-2 text-right tabular-nums">{r.count}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{formatTiyn(r.sumTiyn)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong font-bold">
              <th scope="row" className="py-2">
                {t.total}
              </th>
              <td className="py-2 text-right tabular-nums">{total.count}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{formatTiyn(total.sum)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/** Отчёт оператора из журнала денег (ADR-009): сделки по статусам, операции, расхождения manual, CSV. */
export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage("/operator/report");
  const parsed = reportSchema.safeParse(flatParams(await searchParams));
  const { staleDays } = parsed.success ? parsed.data : { staleDays: 3 };
  const report = await buildReport(user, { staleDays });
  const deals = report.deals.reduce((acc, r) => ({ count: acc.count + r.count, sum: acc.sum + r.sumTiyn }), { count: 0, sum: 0n });

  return (
    <Container className="pb-10">
      <PageHeader
        title={t.title}
        back={{ href: "/operator", label: o.backToPanel }}
        actions={
          <Link href="/operator/income" className={buttonClasses({ variant: "secondary" })}>
            {t.incomeLink}
          </Link>
        }
      />
      <div className="flex flex-col gap-8">
        <ul aria-label={t.stats} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-3">
          <li className="flex">
            <Stat className="flex-1" icon={<Handshake />} value={deals.count} label={t.statDeals} />
          </li>
          <li className="flex">
            <Stat className="flex-1" icon={<TriangleAlert />} value={report.discrepancies.length} label={t.statDiscrepancies} />
          </li>
          <li className="col-span-full flex sm:col-span-1">
            <Stat className="flex-1" icon={<Wallet />} value={formatTiyn(deals.sum)} label={t.statPrice} />
          </li>
        </ul>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-6">
          <Totals title={t.deals} head={t.status} rows={report.deals.map((r) => ({ key: r.status, label: o.dealStatus[r.status], count: r.count, sumTiyn: r.sumTiyn }))} />
          <Totals
            title={t.operations}
            head={t.type}
            rows={report.operations.map((r) => ({
              key: `${r.type}-${r.status}`,
              label: `${o.money.types[r.type]}: ${o.money.status[r.status].toLowerCase()}`,
              count: r.count,
              sumTiyn: r.sumTiyn,
            }))}
          />
        </div>

        <section aria-labelledby="discrepancies" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <SectionTitle id="discrepancies" title={t.discrepancies} />
            <p className="max-w-prose text-base text-ink-soft">{t.discrepanciesHint(staleDays)}</p>
          </div>
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input label={t.staleDaysLabel} name="staleDays" type="number" inputMode="numeric" min={1} max={60} defaultValue={staleDays} className="sm:w-48" />
            <Button type="submit" variant="secondary">
              {t.apply}
            </Button>
          </form>
          {report.discrepancies.length === 0 ? (
            <Alert tone="success">{t.discrepanciesEmpty}</Alert>
          ) : (
            <ul className={LIST_GRID}>
              {report.discrepancies.map((d) => (
                <ListCard
                  key={d.transactionId}
                  href={`/operator/deals/${d.dealId}`}
                  title={o.money.deal(d.dealNumber, d.dealTitle)}
                  meta={[
                    o.money.types[d.type],
                    <span key="at">
                      {t.createdAt} <DateText value={d.createdAt} format="dateTime" />, {o.money.waiting(d.daysWaiting).toLowerCase()}
                    </span>,
                  ]}
                  aside={formatTiyn(d.amountTiyn)}
                />
              ))}
            </ul>
          )}
        </section>

        <Card title={t.downloads} description={t.downloadsHint}>
          <div className="flex flex-wrap gap-3">
            {CSV_KINDS.map((kind) => (
              // Файл, а не страница: обычная ссылка с download, без клиентской навигации.
              <a key={kind} href={`/operator/report/csv?kind=${kind}&staleDays=${staleDays}`} download className={buttonClasses({ variant: "secondary" })}>
                <Download aria-hidden className="size-5 shrink-0" />
                {t.csvKinds[kind]}
              </a>
            ))}
          </div>
        </Card>
      </div>
    </Container>
  );
}
