import type { DealStatus, PaymentDue, PaymentMode, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { isPayable } from "./transitions";

/**
 * «Финансы» исполнителя — только чтение оплат этапов его сделок. Новых денежных операций нет:
 * деньги идут от заказчика исполнителю напрямую (manual) или раскрываются банком (эскроу).
 * Комиссии нет (ответ №3), поэтому сумма к получению — сумма этапа.
 */

/** received — получено; expected — этап пора оплатить (аванс или принятая работа); upcoming — ещё впереди по идущей сделке. */
export type FinanceState = "received" | "expected" | "upcoming";

export type FinanceRow = {
  stageId: string;
  dealId: string;
  dealNumber: number;
  dealTitle: string;
  stageOrder: number;
  stageTitle: string;
  amount: number;
  paymentDue: PaymentDue;
  payment: StagePaymentStatus;
  mode: PaymentMode;
  state: FinanceState;
  /** Получено — когда подтверждено; отмечено заказчиком — когда отмечено; иначе null. */
  date: Date | null;
};

/** Месяц по времени Алматы: «2026-11». */
export type MonthKey = `${number}-${"01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"}`;

/** Заработок за месяц: полученное по дате подтверждения оплаты. */
export type MonthEarnings = {
  month: MonthKey;
  received: number;
  /** Получено в предыдущем месяце — для сравнения. */
  previous: number;
  /** Полученные в этом месяце оплаты, новые сверху. */
  rows: FinanceRow[];
  /** Соседние месяцы от первой оплаты до текущего; null — дальше идти некуда. */
  prev: MonthKey | null;
  next: MonthKey | null;
};

export type ExecutorFinance = {
  totals: Record<FinanceState, number>;
  rows: FinanceRow[];
  /** Есть сделки, где оплату раскрывает банк (эскроу): от этого зависят тексты экрана. */
  hasEscrow: boolean;
  month: MonthEarnings;
};

/** Месяцы считаем по времени Алматы (UTC+5, без перехода на летнее время). */
const MONTH_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit" });

export function monthOf(date: Date): MonthKey {
  const part = (type: "year" | "month") => MONTH_PARTS.formatToParts(date).find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}` as MonthKey;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Месяц из адреса страницы: «ГГГГ-ММ», иначе null. */
export function parseMonth(value: string | undefined): MonthKey | null {
  return value && MONTH_RE.test(value) ? (value as MonthKey) : null;
}

function shiftMonth(month: MonthKey, by: number): MonthKey {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}` as MonthKey;
}

/**
 * Заработок за месяц `wanted` (по умолчанию — текущий). Листать можно от месяца первой оплаты до текущего;
 * месяц за этими краями — ближайший край. Ключи «ГГГГ-ММ» сравниваются как строки.
 */
export function monthEarnings(rows: readonly FinanceRow[], wanted: MonthKey | null | undefined, now: Date): MonthEarnings {
  const received = rows.filter((r): r is FinanceRow & { date: Date } => r.state === "received" && r.date !== null);
  const current = monthOf(now);
  const first = received.reduce((min, r) => (monthOf(r.date) < min ? monthOf(r.date) : min), current);
  const month = !wanted || wanted > current ? current : wanted < first ? first : wanted;
  const sum = (m: MonthKey) => received.reduce((total, r) => (monthOf(r.date) === m ? total + r.amount : total), 0);
  return {
    month,
    received: sum(month),
    previous: sum(shiftMonth(month, -1)),
    rows: received.filter((r) => monthOf(r.date) === month).sort((a, b) => b.date.getTime() - a.date.getTime()),
    prev: month > first ? shiftMonth(month, -1) : null,
    next: month < current ? shiftMonth(month, 1) : null,
  };
}

const CLOSED_DEALS: ReadonlySet<DealStatus> = new Set(["CANCELLED", "TERMINATED"]);

/**
 * Состояние оплаты этапа для исполнителя. Полученное остаётся полученным при любом исходе сделки;
 * неоплаченное по отменённой или расторгнутой сделке не ждём (null — в список не попадает).
 */
export function financeState(f: {
  payment: StagePaymentStatus;
  dealStatus: DealStatus;
  stageStatus: StageStatus;
  paymentDue: PaymentDue;
  previousDone: boolean;
}): FinanceState | null {
  if (f.payment === "CONFIRMED") return "received";
  if (CLOSED_DEALS.has(f.dealStatus)) return null;
  return isPayable(f) ? "expected" : "upcoming";
}

const ORDER: Record<FinanceState, number> = { expected: 0, upcoming: 1, received: 2 };

/** Сначала то, что ждёт оплаты, затем будущее (по сделке и этапу), затем полученное (новые сверху). */
function byPriority(a: FinanceRow, b: FinanceRow): number {
  if (a.state !== b.state) return ORDER[a.state] - ORDER[b.state];
  if (a.state === "received") return (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
  return b.dealNumber - a.dealNumber || a.stageOrder - b.stageOrder;
}

const done = (s: StageStatus) => s === "ACCEPTED" || s === "CLOSED";

/**
 * Оплаты этапов своих сделок и заработок за месяц `month` (по умолчанию — текущий на момент `now`).
 * Только исполнитель в активной роли; чужие сделки не видны.
 */
export async function getExecutorFinance(user: CurrentUser, opts: { month?: MonthKey | null; now?: Date } = {}): Promise<ExecutorFinance> {
  if (user.role !== "EXECUTOR" || !user.executor) return fail.forbidden();
  const deals = await db.deal.findMany({
    where: { executorId: user.executor.id },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      paymentMode: true,
      stages: { orderBy: { order: "asc" }, select: { id: true, order: true, title: true, status: true, paymentDue: true, payment: true } },
    },
  });

  const rows: FinanceRow[] = [];
  for (const deal of deals) {
    deal.stages.forEach((stage, i) => {
      if (!stage.payment) return;
      const previous = deal.stages[i - 1];
      const state = financeState({
        payment: stage.payment.status,
        dealStatus: deal.status,
        stageStatus: stage.status,
        paymentDue: stage.paymentDue,
        previousDone: !previous || done(previous.status),
      });
      if (!state) return;
      rows.push({
        stageId: stage.id,
        dealId: deal.id,
        dealNumber: deal.number,
        dealTitle: deal.title,
        stageOrder: stage.order,
        stageTitle: stage.title,
        amount: stage.payment.amount,
        paymentDue: stage.paymentDue,
        payment: stage.payment.status,
        mode: deal.paymentMode,
        state,
        date: stage.payment.confirmedAt ?? stage.payment.markedPaidAt,
      });
    });
  }
  rows.sort(byPriority);

  const totals: Record<FinanceState, number> = { received: 0, expected: 0, upcoming: 0 };
  for (const r of rows) totals[r.state] += r.amount;
  return { totals, rows, hasEscrow: deals.some((d) => d.paymentMode !== "MANUAL"), month: monthEarnings(rows, opts.month, opts.now ?? new Date()) };
}
