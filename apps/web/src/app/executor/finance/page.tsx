import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getExecutorFinance, monthOf, type FinanceRow, type MonthKey } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { cn, Container, Money, PageHeader, TrustNote, formatDate, formatTiyn } from "@/ui";
import { NoAccess } from "@/app/_components/NoAccess";
import { pageUser } from "@/app/requests/_parts/guard";
import { barPercent, chartWindow, monthTitle, selectedMonth, shiftMonth, versusPrevious } from "./_parts/months";

const t = ru.executor.finance;

export const metadata: Metadata = { title: t.metaTitle };

const BASE = "/executor/finance";
const hrefOf = (month: MonthKey) => `${BASE}?month=${month}`;

/**
 * «Финансы» мастера (макет master-screens, экран 3) — только из журнала денег (deal-core.getExecutorFinance):
 * месяц со стрелками (в адресе ?month=YYYY-MM, по умолчанию текущий по времени Казахстана) и сравнение с прошлым →
 * столбики выплат за шесть месяцев → выплаты месяца → «Ожидает выплаты после приёмки»: деньги покупателей в банке
 * до подписания акта. Только чтение: действия — на странице сделки.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const user = await pageUser("EXECUTOR", BASE);
  if (!user) return <NoAccess description={ru.requests.noAccessExecutor} />;
  const [finance, sp] = await Promise.all([getExecutorFinance(user), searchParams]);
  const current = monthOf(new Date());
  const month = selectedMonth(sp.month, current);
  const prev = shiftMonth(month, -1);
  const bars = chartWindow(finance.months, month);
  const total = bars.at(-1)!.receivedTiyn;
  const max = bars.reduce((a, b) => (b.receivedTiyn > a ? b.receivedTiyn : a), 0n);
  const compare = versusPrevious(total, bars.at(-2)!.receivedTiyn, prev);
  const payouts = finance.rows.filter((r) => r.state === "received" && monthOf(r.at) === month);
  const reserved = finance.rows.filter((r) => r.state === "reserved");

  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />

      <section aria-labelledby="fin-month" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
        {/* При крупном шрифте строка переносится: название месяца не сжимается до буквы в строке. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <MonthArrow href={hrefOf(prev)} label={t.prevMonth} dir="prev" />
          <h2 id="fin-month" className="min-w-[min(9em,100%)] flex-1 text-center text-xl font-bold text-ink">
            {monthTitle(month)}
          </h2>
          {month < current ? <MonthArrow href={hrefOf(shiftMonth(month, 1))} label={t.nextMonth} dir="next" /> : <span aria-hidden className="size-control-sm shrink-0" />}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-base text-ink-soft">{t.monthTotal}</span>
          <Money amount={total} className="text-3xl font-extrabold break-words text-ink" />
          {compare && <span className={cn("text-base font-bold", total >= bars.at(-2)!.receivedTiyn ? "text-primary" : "text-ink-soft")}>{compare}</span>}
        </div>

        <figure className="flex flex-col gap-2">
          <ol aria-label={t.chartLabel} className="flex h-28 items-end gap-2">
            {bars.map((b) => (
              <li key={b.month} className="flex h-full min-w-0 flex-1 items-end">
                <span
                  aria-hidden
                  className={cn("w-full rounded-t-control", b.month === month ? "bg-primary" : "bg-line-strong/50")}
                  style={{ height: `max(0.25rem, ${barPercent(b.receivedTiyn, max)}%)` }}
                />
                <span className="sr-only">{t.bar(monthTitle(b.month), formatTiyn(b.receivedTiyn))}</span>
              </li>
            ))}
          </ol>
          <figcaption aria-hidden className="text-sm text-muted">
            {t.chartRange(monthTitle(bars[0]!.month), monthTitle(month))}
          </figcaption>
        </figure>
      </section>

      <Rows id="fin-payouts" title={t.monthPayouts} rows={payouts} empty={t.emptyMonth} />

      {reserved.length > 0 && (
        <div className="flex flex-col gap-3">
          <TrustNote>
            {t.awaiting}: <Money amount={finance.reservedTiyn} className="font-extrabold" /> — {t.awaitingNote}
          </TrustNote>
          <Rows id="fin-reserved" title={t.awaitingTitle} rows={reserved} />
        </div>
      )}
    </Container>
  );
}

/** Стрелка месяца: ссылка 48 × 48, подпись — для диктора и подсказки. */
function MonthArrow({ href, label, dir }: { href: string; label: string; dir: "prev" | "next" }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex size-control-sm shrink-0 items-center justify-center rounded-control border border-line text-ink no-underline hover:border-line-strong"
    >
      <Icon aria-hidden className="size-6" />
    </Link>
  );
}

/** Выплаты и резервы строками: заказ слева, сумма справа; строка ведёт к сделке. */
function Rows({ id, title, rows, empty }: { id: string; title: string; rows: readonly FinanceRow[]; empty?: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-xl font-bold text-ink">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-4 text-base text-ink-soft">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {rows.map((r) => (
            <li key={`${r.dealId}-${r.state}-${r.at.getTime()}`}>
              <Link href={`/deals/${r.dealId}`} className="flex min-h-control flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-ink no-underline hover:bg-sunken">
                <span className="flex min-w-0 grow basis-[12em] flex-col gap-0.5">
                  <span className="text-lg font-semibold break-words">{r.title}</span>
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
