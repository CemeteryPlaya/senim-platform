import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { getExecutorFinance, parseMonth, type FinanceRow, type MonthEarnings, type MonthKey } from "@/modules/deal-core";
import { activeRailMode } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { Alert, Container, Money, PageHeader, cn, formatDate, formatMoney } from "@/ui";
import { NoAccess } from "@/app/_components/NoAccess";
import { pageUser } from "@/app/requests/_parts/guard";

const t = ru.executor.finance;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Финансы» исполнителя (ответ владельца №34, макет 12, экран 4): заработок за выбранный месяц и сравнение
 * с прошлым, оплаты этого месяца, что ждёт оплаты. Только чтение: подтверждение оплаты — на странице сделки.
 * Вывода средств и комиссии нет: деньги идут от заказчика исполнителю напрямую (или их перечисляет банк).
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const user = await pageUser("EXECUTOR", "/executor/finance");
  if (!user) return <NoAccess description={ru.requests.noAccessExecutor} />;

  const [finance, rail] = await Promise.all([getExecutorFinance(user, { month: parseMonth(sp.month) }), activeRailMode()]);
  const escrow = finance.hasEscrow || rail !== "manual";
  const { month } = finance;
  const waiting = finance.rows.filter((r) => r.state === "expected");
  const toConfirm = waiting.filter((r) => r.payment === "MARKED_PAID").length;

  return (
    <Container size="form" className="flex flex-col gap-10 pb-12">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />

      <section aria-labelledby="earned" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 id="earned" className="min-w-0 grow basis-[10em] text-lg font-semibold text-ink-soft">
              {t.earnedIn(monthWithYear(month.month))}
            </h2>
            <MonthSwitcher month={month} />
          </div>
          <p className="text-display font-extrabold text-ink">
            <Money amount={month.received} />
          </p>
          <Comparison month={month} />
        </div>
        <dl aria-label={t.totalsLabel} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-x-6 gap-y-4 border-t border-line pt-6">
          <Total label={t.totals.expected} amount={finance.totals.expected} />
          <Total label={t.totals.upcoming} amount={finance.totals.upcoming} />
        </dl>
      </section>

      {toConfirm > 0 && (
        <Alert tone="accent" title={t.confirmTitle}>
          {t.confirmText(toConfirm)}
        </Alert>
      )}

      <PaymentList id="paid" title={t.paidIn(monthName(month.month))} rows={month.rows} empty={t.emptyMonth} line={(r) => formatDate(r.date)} />

      {waiting.length > 0 && <PaymentList id="waiting" title={t.waitingTitle} rows={waiting} line={waitingText} />}

      <p className="text-base text-muted">{escrow ? t.noteEscrow : t.noteManual}</p>
    </Container>
  );
}

const monthParts = (key: MonthKey) => {
  const [year, m] = key.split("-").map(Number) as [number, number];
  return { name: t.months[m - 1]!, year };
};

/** «ноябрь». */
const monthName = (key: MonthKey) => monthParts(key).name;

/** «ноябрь 2026». */
function monthWithYear(key: MonthKey): string {
  const { name, year } = monthParts(key);
  return `${name} ${year}`;
}

/**
 * Стрелки «‹ ›» — ссылки 48 px на соседние месяцы (подписаны для диктора); на краю промежутка стрелка
 * неактивна, но остаётся на месте. Стоят парой справа от заголовка; при крупном шрифте уходят под него.
 */
function MonthSwitcher({ month }: { month: MonthEarnings }) {
  const arrow = (to: MonthKey | null, label: (m: string) => string, icon: ReactNode) => {
    const box = "inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-line bg-surface [&_svg]:size-6";
    if (!to) {
      return (
        <span aria-hidden className={cn(box, "text-line-strong")}>
          {icon}
        </span>
      );
    }
    return (
      <Link href={`/executor/finance?month=${to}`} aria-label={label(monthWithYear(to))} className={cn(box, "text-ink no-underline transition-colors duration-150 hover:border-line-strong")}>
        {icon}
      </Link>
    );
  };
  return (
    <nav aria-label={t.monthNav} className="flex gap-2">
      {arrow(month.prev, t.prevMonth, <ChevronLeft aria-hidden />)}
      {arrow(month.next, t.nextMonth, <ChevronRight aria-hidden />)}
    </nav>
  );
}

/** Разница с прошлым месяцем: знак и слова, цвет — только в помощь. Оба месяца пустые — строки нет. */
function Comparison({ month }: { month: MonthEarnings }) {
  const delta = month.received - month.previous;
  if (month.received === 0 && month.previous === 0) return null;
  if (delta === 0) return <p className="text-base text-muted">{t.sameAsPrevious}</p>;
  const sign = delta > 0 ? "+" : "−";
  return <p className={cn("text-base font-semibold", delta > 0 ? "text-primary" : "text-muted")}>{t.vsPrevious(`${sign}${formatMoney(Math.abs(delta))}`)}</p>;
}

function Total({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-base text-muted">{label}</dt>
      <dd className="text-xl font-bold text-ink">
        <Money amount={amount} />
      </dd>
    </div>
  );
}

function waitingText(r: FinanceRow): string {
  if (r.payment === "MARKED_PAID") return t.status.confirm;
  return r.mode === "MANUAL" ? t.status.waitClient : t.status.waitBank;
}

/** Оплаты строками: заказ и этап слева, сумма справа; строка ведёт к этапам сделки. */
function PaymentList<R extends FinanceRow>({ id, title, rows, empty, line }: { id: string; title: string; rows: readonly R[]; empty?: string; line: (r: R) => string }) {
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
            <li key={r.stageId}>
              <Link href={`/deals/${r.dealId}#stages`} className="flex min-h-control flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4 text-ink no-underline hover:bg-surface">
                <span className="flex min-w-0 grow basis-[12em] flex-col gap-0.5">
                  <span className="text-lg font-semibold">{r.dealTitle}</span>
                  <span className={cn("text-base", r.payment === "MARKED_PAID" && r.state === "expected" ? "font-semibold text-primary" : "text-muted")}>
                    {t.stageLine(r.stageTitle, line(r))}
                  </span>
                </span>
                <Money amount={r.amount} className="shrink-0 text-lg font-bold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
