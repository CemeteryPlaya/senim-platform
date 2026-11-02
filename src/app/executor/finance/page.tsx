import type { Metadata } from "next";
import Link from "next/link";
import { getExecutorFinance, type FinanceRow, type MonthKey } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { Container, Money, PageHeader, formatDate } from "@/ui";
import { NoAccess } from "@/app/_components/NoAccess";
import { pageUser } from "@/app/requests/_parts/guard";

const t = ru.executor.finance;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Финансы» мастера — только из журнала денег (deal-core.getExecutorFinance): получено — подтверждённые выплаты
 * банка, по месяцам (время Казахстана); зарезервировано — деньги покупателей в банке до подписания акта.
 * Только чтение: действия — на странице сделки.
 */
export default async function FinancePage() {
  const user = await pageUser("EXECUTOR", "/executor/finance");
  if (!user) return <NoAccess description={ru.requests.noAccessExecutor} />;
  const finance = await getExecutorFinance(user);
  const received = finance.rows.filter((r) => r.state === "received");
  const reserved = finance.rows.filter((r) => r.state === "reserved");

  return (
    <Container size="form" className="flex flex-col gap-10 pb-12">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-x-6 gap-y-6">
        <div className="flex flex-col gap-1">
          <dt className="text-lg font-semibold text-ink-soft">{t.received}</dt>
          <dd className="text-display font-extrabold text-ink">
            <Money amount={finance.receivedTiyn} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-lg font-semibold text-ink-soft">{t.reserved}</dt>
          <dd className="text-2xl font-bold text-ink">
            <Money amount={finance.reservedTiyn} />
          </dd>
        </div>
      </dl>

      {reserved.length > 0 && <Rows id="reserved" title={t.reservedTitle} rows={reserved} />}

      {finance.months.length > 0 && (
        <section aria-labelledby="months" className="flex flex-col gap-3">
          <h2 id="months" className="text-xl font-extrabold text-ink">
            {t.byMonth}
          </h2>
          <dl className="flex flex-col divide-y divide-line border-y border-line">
            {finance.months.map((m) => (
              <div key={m.month} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <dt className="flex min-w-0 grow basis-[10em] flex-col">
                  <span className="text-lg font-semibold text-ink">{monthWithYear(m.month)}</span>
                  <span className="text-base text-muted">{t.payoutsCount(m.deals)}</span>
                </dt>
                <dd className="text-lg font-bold text-ink">
                  <Money amount={m.receivedTiyn} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <Rows id="payouts" title={t.payoutsTitle} rows={received} empty={t.emptyPayouts} />
    </Container>
  );
}

/** «ноябрь 2026». */
function monthWithYear(key: MonthKey): string {
  const [year, m] = key.split("-").map(Number) as [number, number];
  return `${t.months[m - 1]} ${year}`;
}

/** Выплаты и резервы строками: заказ слева, сумма справа; строка ведёт к сделке. */
function Rows({ id, title, rows, empty }: { id: string; title: string; rows: readonly FinanceRow[]; empty?: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-xl font-extrabold text-ink">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-base text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <li key={`${r.dealId}-${r.state}-${r.at.getTime()}`}>
              <Link href={`/deals/${r.dealId}`} className="flex min-h-control flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4 text-ink no-underline hover:bg-surface">
                <span className="flex min-w-0 grow basis-[12em] flex-col gap-0.5">
                  <span className="text-lg font-semibold">{r.title}</span>
                  <span className="text-base text-muted">{t.rowLine(ru.deal.number(r.dealNumber), formatDate(r.at))}</span>
                </span>
                <Money amount={r.amountTiyn} className="shrink-0 text-lg font-bold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
