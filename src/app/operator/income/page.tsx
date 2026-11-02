import type { Metadata } from "next";
import { Download, Wallet } from "lucide-react";
import Link from "next/link";
import { ru } from "@/i18n/ru";
import { incomePeriodSchema, incomeReport } from "@/modules/operator";
import { Button, buttonClasses, Card, Container, DateText, EmptyState, Input, PageHeader, Stat, StatusBadge } from "@/ui";
import { formatTiyn } from "@/ui/format";
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
        <form method="get" className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Input label={t.from} name="from" type="date" defaultValue={shown.from} error={parsed.success ? undefined : o.validation.period} />
          <Input label={t.to} name="to" type="date" defaultValue={shown.to} />
          <Button type="submit" variant="secondary">
            {t.apply}
          </Button>
        </form>

        <ul aria-label={t.title} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
          <li className="flex">
            <Stat className="flex-1" value={formatTiyn(report.protectionTiyn)} label={t.protection} />
          </li>
          <li className="flex">
            <Stat className="flex-1" value={formatTiyn(report.guaranteeTiyn)} label={t.guarantee} />
          </li>
          <li className="flex">
            <Stat className="flex-1" icon={<Wallet />} value={formatTiyn(report.totalTiyn)} label={t.total} />
          </li>
        </ul>

        <Card title={t.byDeal}>
          {report.rows.length === 0 ? (
            <EmptyState title={t.empty} titleAs="h3" />
          ) : (
            <ul className="flex flex-col">
              {report.rows.map((r) => (
                <li key={r.transactionId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0">
                  <span className="flex min-w-0 flex-col gap-1">
                    <Link href={`/operator/deals/${r.dealId}`} className="font-semibold text-primary underline">
                      {t.deal(r.dealNumber)}
                    </Link>
                    <span className="text-sm text-muted">
                      {t.settledAt} <DateText value={r.settledAt} format="dateTime" />
                    </span>
                    {r.isTest && <StatusBadge tone="neutral" className="self-start">{t.testMark}</StatusBadge>}
                  </span>
                  <span className="flex flex-col items-end text-base tabular-nums">
                    <span className="font-bold text-ink">{formatTiyn(r.totalTiyn)}</span>
                    <span className="text-sm text-ink-soft">
                      {t.protection}: {formatTiyn(r.protectionTiyn)}
                    </span>
                    <span className="text-sm text-ink-soft">
                      {t.guarantee}: {formatTiyn(r.guaranteeTiyn)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <a href={csvHref} className={buttonClasses({ variant: "secondary", className: "self-start" })} download>
          <Download aria-hidden className="size-5" />
          {t.csv}
        </a>
      </div>
    </Container>
  );
}
