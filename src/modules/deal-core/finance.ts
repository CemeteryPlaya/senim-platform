import type { CurrentUser } from "@/modules/identity";
import { moneyFacts, type LedgerEntry } from "@/modules/payments";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";

/**
 * «Финансы мастера» — только из журнала денег: получено = подтверждённые SPLIT_MASTER по месяцам
 * (время Казахстана, UTC+5); зарезервировано = сделки, где деньги покупателя в банке, а выплаты ещё нет.
 */

export type MonthKey = `${number}-${string}`;
export type MonthEarnings = { month: MonthKey; receivedTiyn: bigint; deals: number };
export type FinanceRow = { dealId: string; dealNumber: number; title: string; amountTiyn: bigint; at: Date; state: "received" | "reserved" };
export type ExecutorFinance = { months: MonthEarnings[]; reservedTiyn: bigint; receivedTiyn: bigint; rows: FinanceRow[] };

const KZ_OFFSET_MS = 5 * 3600 * 1000;

export function monthOf(at: Date): MonthKey {
  const local = new Date(at.getTime() + KZ_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

type FinanceDeal = { id: string; number: number; title: string; payoutTiyn: bigint; entries: LedgerEntry[] };

/** Строки одной сделки: каждая подтверждённая выплата и, пока деньги в банке без выплаты, — резерв. */
function rowsOf(d: FinanceDeal): FinanceRow[] {
  const row = (amountTiyn: bigint, at: Date, state: FinanceRow["state"]): FinanceRow => ({ dealId: d.id, dealNumber: d.number, title: d.title, amountTiyn, at, state });
  const received = d.entries.filter((e) => e.type === "SPLIT_MASTER" && e.status === "SUCCEEDED").map((e) => row(e.amountTiyn, e.settledAt ?? e.createdAt, "received"));
  // Резерв — деньги в банке, выплаты ещё не было и возврат не запрошен (выплата в банке — тоже резерв).
  const { heldEntry, refundEntry } = moneyFacts(d.entries);
  return heldEntry && received.length === 0 && !refundEntry ? [...received, row(d.payoutTiyn, heldEntry.settledAt ?? heldEntry.createdAt, "reserved")] : received;
}

function byMonth(rows: FinanceRow[]): MonthEarnings[] {
  const months = new Map<MonthKey, MonthEarnings>();
  for (const r of rows) {
    const key = monthOf(r.at);
    const m = months.get(key) ?? { month: key, receivedTiyn: 0n, deals: 0 };
    m.receivedTiyn += r.amountTiyn;
    m.deals += 1;
    months.set(key, m);
  }
  return [...months.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** Чистая сборка по записям журнала сделок мастера. */
export function financeOf(deals: FinanceDeal[]): ExecutorFinance {
  const rows = deals.flatMap(rowsOf).sort((a, b) => b.at.getTime() - a.at.getTime());
  const received = rows.filter((r) => r.state === "received");
  const total = (list: FinanceRow[]) => list.reduce((a, r) => a + r.amountTiyn, 0n);
  return { months: byMonth(received), reservedTiyn: total(rows.filter((r) => r.state === "reserved")), receivedTiyn: total(received), rows };
}

export async function getExecutorFinance(user: CurrentUser): Promise<ExecutorFinance> {
  if (user.role !== "EXECUTOR" || !user.executor) return fail.forbidden();
  const deals = await db.deal.findMany({
    where: { executorId: user.executor.id, transactions: { some: {} } },
    select: { id: true, number: true, title: true, payoutTiyn: true, transactions: { orderBy: { seq: "asc" } } },
  });
  return financeOf(deals.map(({ transactions, ...d }) => ({ ...d, entries: transactions.map((t) => ({ ...t, disputeShareTiyn: null })) })));
}
