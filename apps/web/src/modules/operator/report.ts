import { DealStatus, MoneyTransactionStatus, MoneyTransactionType } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { platformIncomeReport, type IncomeReport } from "@/modules/payments";
import { db } from "@/platform/db";
import { assertOperator } from "./access";
import { csvDateTime, csvTiyn, toCsv, type CsvCell } from "./csv";
import type { CsvKind, IncomePeriod } from "./schemas";

/**
 * Отчёт оператора (ADR-009): сделки по статусам и операции журнала денег по типам и статусам.
 * Расхождения — операции manual, которые ждут банковского документа дольше N дней: деньги в банке
 * уже могли двинуться, а журнал об этом не знает. Суммы — тиыны (BigInt).
 */

const DAY = 86_400_000;
const t = ru.operator;

export type StatusTotal<S extends string> = { status: S; count: number; sumTiyn: bigint };
export type OperationTotal = { type: MoneyTransactionType; status: MoneyTransactionStatus; count: number; sumTiyn: bigint };

/** Все значения перечисления по порядку, с нулями для отсутствующих. */
function totals<S extends string>(all: Record<string, S>, groups: { status: S; count: number; sum: bigint | null }[]): StatusTotal<S>[] {
  return Object.values(all).map((status) => {
    const g = groups.find((x) => x.status === status);
    return { status, count: g?.count ?? 0, sumTiyn: g?.sum ?? 0n };
  });
}

async function staleOperations(staleDays: number, now: Date) {
  const rows = await db.moneyTransaction.findMany({
    where: { provider: "MANUAL", status: "PENDING", createdAt: { lt: new Date(now.getTime() - staleDays * DAY) } },
    orderBy: { seq: "asc" },
    select: { id: true, type: true, amountTiyn: true, createdAt: true, idempotencyKey: true, deal: { select: { id: true, number: true, title: true } } },
  });
  return rows.map((r) => ({
    transactionId: r.id,
    type: r.type,
    amountTiyn: r.amountTiyn,
    createdAt: r.createdAt,
    idempotencyKey: r.idempotencyKey,
    dealId: r.deal.id,
    dealNumber: r.deal.number,
    dealTitle: r.deal.title,
    daysWaiting: Math.floor((now.getTime() - r.createdAt.getTime()) / DAY),
  }));
}

export async function buildReport(user: CurrentUser, input: { staleDays: number }, now = new Date()) {
  assertOperator(user);
  const [deals, operations, discrepancies] = await Promise.all([
    db.deal.groupBy({ by: ["status"], _count: { _all: true }, _sum: { priceTiyn: true } }),
    db.moneyTransaction.groupBy({ by: ["type", "status"], _count: { _all: true }, _sum: { amountTiyn: true } }),
    staleOperations(input.staleDays, now),
  ]);
  const ops: OperationTotal[] = Object.values(MoneyTransactionType).flatMap((type) =>
    Object.values(MoneyTransactionStatus).map((status) => {
      const g = operations.find((x) => x.type === type && x.status === status);
      return { type, status, count: g?._count._all ?? 0, sumTiyn: g?._sum.amountTiyn ?? 0n };
    }),
  );
  return {
    deals: totals(DealStatus, deals.map((g) => ({ status: g.status, count: g._count._all, sum: g._sum.priceTiyn }))),
    operations: ops.filter((o) => o.count > 0),
    discrepancies,
  };
}

/** Доход платформы за период — только из журнала (payments.platformIncomeReport). */
export async function incomeReport(user: CurrentUser, period: IncomePeriod): Promise<IncomeReport> {
  assertOperator(user);
  return platformIncomeReport(user, period);
}

/** Выгрузка для Excel: разделитель «;», BOM, защита от формул (см. csv.ts). */
export async function buildCsv(user: CurrentUser, input: { kind: CsvKind; staleDays: number }): Promise<string> {
  assertOperator(user);
  return toCsv(t.csvHeaders[input.kind], await csvRows(user, input));
}

export async function buildIncomeCsv(user: CurrentUser, period: IncomePeriod): Promise<string> {
  const report = await incomeReport(user, period);
  const rows: CsvCell[][] = report.rows.map((r) => [
    r.dealNumber,
    csvDateTime(r.settledAt),
    csvTiyn(r.protectionTiyn),
    csvTiyn(r.guaranteeTiyn),
    csvTiyn(r.totalTiyn),
    r.isTest ? t.income.testMark : "",
  ]);
  rows.push([t.income.total, "", csvTiyn(report.protectionTiyn), csvTiyn(report.guaranteeTiyn), csvTiyn(report.totalTiyn), ""]);
  return toCsv(t.csvHeaders.income, rows);
}

async function csvRows(user: CurrentUser, input: { kind: CsvKind; staleDays: number }): Promise<CsvCell[][]> {
  switch (input.kind) {
    case "deals":
      return (await db.deal.findMany({ orderBy: { number: "asc" } })).map((d) => [
        d.number,
        d.title,
        t.dealStatus[d.status],
        t.providers[d.paymentProvider],
        csvTiyn(d.priceTiyn),
        csvTiyn(d.buyerTotalTiyn),
        csvTiyn(d.payoutTiyn),
        csvDateTime(d.createdAt),
        csvDateTime(d.completedAt),
      ]);
    case "operations":
      return (
        await db.moneyTransaction.findMany({ orderBy: { seq: "asc" }, include: { deal: { select: { number: true } } } })
      ).map((m) => [
        m.seq.toString(),
        m.deal.number,
        t.money.types[m.type],
        t.money.status[m.status],
        csvTiyn(m.amountTiyn),
        m.idempotencyKey,
        m.bankDocNumber ?? m.externalRef,
        csvDateTime(m.createdAt),
        csvDateTime(m.settledAt),
      ]);
    case "discrepancies":
      return (await buildReport(user, input)).discrepancies.map((d) => [d.dealNumber, t.money.types[d.type], csvTiyn(d.amountTiyn), csvDateTime(d.createdAt), d.daysWaiting]);
  }
}
