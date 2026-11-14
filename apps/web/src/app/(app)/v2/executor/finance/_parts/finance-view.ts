import { formatDate } from "@/features/format/format";
import { chartWindow, monthNumber, monthYear, percentChange, selectedMonth, shiftMonth } from "@/features/executor-finance/months";
import { ru } from "@/i18n/ru";
import { monthOf, type ExecutorFinance, type FinanceRow, type MonthKey } from "@/modules/deal-core";
import { to } from "../../../../_shell/paths";

// «Финансы» мастера: чистая сборка того, что показывает экран. Все суммы — из журнала денег (`getExecutorFinance`,
// bigint тиыны); здесь ничего не считается, кроме целого процента к прошлому месяцу (bigint, без float) и выбора окна.

const t = ru.app.masterFinance;

const BASE = "/executor/finance";
const hrefOf = (month: MonthKey): string => `${to(BASE)}?month=${month}`;

/** «Ноябрь 2026». */
export function monthTitle(key: MonthKey): string {
  return `${t.months[monthNumber(key) - 1]} ${monthYear(key)}`;
}

/** Сравнение с прошлым месяцем словами; процент целый, без float, дробь отбрасывается к нулю (−33,3% → «на 33% меньше»). */
export function versusText(percent: bigint, monthIn: string): string {
  if (percent === 0n) return t.versus.same(monthIn);
  return percent > 0n ? t.versus.more(monthIn, `${percent}%`) : t.versus.less(monthIn, `${-percent}%`);
}

export type PaymentRow = { key: string; href: string; title: string; line: string; amountTiyn: bigint };

export type FinanceView = {
  month: MonthKey;
  title: string;
  /** Стрелка «назад» — всегда; «вперёд» — только если месяц раньше текущего. */
  prevHref: string;
  nextHref: string | null;
  totalTiyn: bigint;
  /** «на 18% больше, чем в октябре»; в прошлом месяце ничего не было — нет сравнения. */
  versus: string | null;
  /** Шесть месяцев, последний — выбранный. */
  bars: { label: string; name: string; value: bigint; /** Выбранный месяц (последний столбик): в kit это `current`. */ selected: boolean }[];
  payments: PaymentRow[];
  awaiting: { totalTiyn: bigint; rows: PaymentRow[] } | null;
  /** Журнал мастера пуст (ни получено, ни ожидает): обучающий экран вместо месяца. */
  empty: boolean;
};

function rowOf(r: FinanceRow): PaymentRow {
  return {
    key: `${r.dealId}-${r.state}-${r.at.getTime()}`,
    href: to(`/deals/${r.dealId}`),
    title: r.title,
    line: t.payments.row(t.payments.dealNumber(r.dealNumber), formatDate(r.at)),
    amountTiyn: r.amountTiyn,
  };
}

/** Экран по журналу, месяцу из адреса (`?month=`) и сейчас: неверный или будущий месяц — текущий. */
export function financeView(finance: ExecutorFinance, monthParam: unknown, now: Date): FinanceView {
  const current = monthOf(now);
  const month = selectedMonth(monthParam, current);
  const window = chartWindow(finance.months, month);
  const selected = window.at(-1)!;
  const previous = window.at(-2)!;
  const percent = percentChange(selected.receivedTiyn, previous.receivedTiyn);
  const reserved = finance.rows.filter((r) => r.state === "reserved");
  return {
    month,
    title: monthTitle(month),
    prevHref: hrefOf(shiftMonth(month, -1)),
    nextHref: month < current ? hrefOf(shiftMonth(month, 1)) : null,
    totalTiyn: selected.receivedTiyn,
    versus: percent === null ? null : versusText(percent, t.monthsIn[monthNumber(shiftMonth(month, -1)) - 1]!),
    bars: window.map((b) => ({
      label: t.monthsShort[monthNumber(b.month) - 1]!,
      name: monthTitle(b.month),
      value: b.receivedTiyn,
      selected: b.month === month,
    })),
    payments: finance.rows.filter((r) => r.state === "received" && monthOf(r.at) === month).map(rowOf),
    awaiting: reserved.length > 0 ? { totalTiyn: finance.reservedTiyn, rows: reserved.map(rowOf) } : null,
    empty: finance.rows.length === 0,
  };
}
