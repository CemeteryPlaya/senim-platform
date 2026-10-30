import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { ru } from "@/i18n/ru";
import { buildReport, CSV_KINDS, reportSchema, type StatusTotal } from "@/modules/operator";
import { Alert, Button, buttonClasses, Card, Container, DateText, Input, Money, PageHeader, StatusBadge } from "@/ui";
import { flatParams, requireOperatorPage } from "../_lib/guard";

const o = ru.operator;
const t = o.report;

export const metadata: Metadata = { title: t.title };

function Totals<S extends string>({ title, rows, label }: { title: string; rows: StatusTotal<S>[]; label: (s: S) => string }) {
  const total = rows.reduce((acc, r) => ({ count: acc.count + r.count, sum: acc.sum + r.sum }), { count: 0, sum: 0 });
  return (
    <Card title={title}>
      <table className="w-full text-left text-base">
        <thead className="text-sm text-muted">
          <tr>
            <th scope="col" className="pb-2 font-semibold">
              {t.status}
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
            <tr key={r.status} className="border-t border-line">
              <th scope="row" className="py-2 pr-3 font-normal">
                {label(r.status)}
              </th>
              <td className="py-2 text-right tabular-nums">{r.count}</td>
              <td className="py-2 pl-3 text-right">
                <Money amount={r.sum} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-strong font-bold">
            <th scope="row" className="py-2">
              {t.total}
            </th>
            <td className="py-2 text-right tabular-nums">{total.count}</td>
            <td className="py-2 pl-3 text-right">
              <Money amount={total.sum} />
            </td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage("/operator/report");
  const parsed = reportSchema.safeParse(flatParams(await searchParams));
  const { staleDays } = parsed.success ? parsed.data : { staleDays: 3 };
  const report = await buildReport(user, { staleDays });

  return (
    <Container>
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: o.backToPanel }} />
      <div className="flex flex-col gap-6">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input label={t.staleDaysLabel} name="staleDays" type="number" inputMode="numeric" min={1} max={60} defaultValue={staleDays} className="sm:w-48" />
          <Button type="submit" variant="secondary">
            {t.apply}
          </Button>
        </form>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Totals title={t.deals} rows={report.deals} label={(s) => o.dealStatus[s]} />
          <Totals title={t.stages} rows={report.stages} label={(s) => o.stageStatus[s]} />
          <Totals title={t.payments} rows={report.payments} label={(s) => o.paymentStatus[s]} />
        </div>

        <Card title={t.discrepancies} description={t.discrepanciesHint(staleDays)}>
          {report.discrepancies.length === 0 ? (
            <Alert tone="success">{t.discrepanciesEmpty}</Alert>
          ) : (
            <ul className="flex flex-col">
              {report.discrepancies.map((d) => (
                <li key={`${d.dealId}-${d.stageTitle}`} className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
                  <Link href={`/deals/${d.dealId}`} className="font-semibold text-ink">
                    {o.disputes.deal(d.dealNumber)}: {d.dealTitle}
                  </Link>
                  <span className="text-ink-soft">
                    {d.stageTitle}, <Money amount={d.amount} />
                  </span>
                  <span className="text-sm text-muted">
                    {t.markedAt} <DateText value={d.markedPaidAt} format="dateTime" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t.reconciliation}>
          {report.reconciliation.length === 0 ? (
            <p className="text-ink-soft">{t.reconciliationEmpty}</p>
          ) : (
            report.reconciliation.map((r) => (
              <section key={r.dealId} aria-label={o.disputes.deal(r.dealNumber)} className="flex flex-col gap-2 border-b border-line pb-4 last:border-b-0">
                <h3 className="text-lg font-bold text-ink">
                  {o.disputes.deal(r.dealNumber)}: {r.title}
                </h3>
                {r.rows === null ? (
                  <Alert tone="warning">{t.statementUnavailable}</Alert>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {r.rows.map((row, i) => (
                      <li key={`${row.idempotencyKey ?? row.externalRef}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                        <StatusBadge tone={row.status === "MATCHED" ? "success" : "danger"}>{t.reconStatus[row.status]}</StatusBadge>
                        <span>{t.opKinds[row.kind]}</span>
                        <span className="text-ink-soft">
                          {t.ours}: {row.ourAmount === null ? o.none : <Money amount={row.ourAmount} />}
                        </span>
                        <span className="text-ink-soft">
                          {t.bank}: {row.bankAmount === null ? o.none : <Money amount={row.bankAmount} />}
                        </span>
                        <span className="break-all text-muted">
                          {t.key}: {row.idempotencyKey ?? o.none}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}
        </Card>

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
