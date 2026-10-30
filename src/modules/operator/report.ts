import { DealStatus, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { reconcile, type ReconciliationRow } from "@/modules/payments";
import { db } from "@/platform/db";
import { isAppError } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { assertOperator } from "./access";
import { csvDateTime, toCsv, type CsvCell } from "./csv";
import type { CsvKind } from "./schemas";

const DAY = 86_400_000;
const t = ru.operator;

export type StatusTotal<S extends string> = { status: S; count: number; sum: number };

/** Все статусы перечисления по порядку, с нулями для отсутствующих. */
function totals<S extends string>(all: Record<string, S>, groups: { status: S; count: number; sum: number | null }[]): StatusTotal<S>[] {
  return Object.values(all).map((status) => {
    const g = groups.find((x) => x.status === status);
    return { status, count: g?.count ?? 0, sum: g?.sum ?? 0 };
  });
}

export type EscrowReconciliation = {
  dealId: string;
  dealNumber: number;
  title: string;
  /** null — выписку получить не удалось (рельс недоступен). */
  rows: ReconciliationRow[] | null;
};

export async function buildReport(user: CurrentUser, input: { staleDays: number }, now = new Date()) {
  assertOperator(user);
  const [deals, stages, payments, stale, escrowDeals] = await Promise.all([
    db.deal.groupBy({ by: ["status"], _count: { _all: true }, _sum: { totalAmount: true } }),
    db.stage.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
    db.stagePayment.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
    db.stagePayment.findMany({
      where: { status: "MARKED_PAID", markedPaidAt: { lt: new Date(now.getTime() - input.staleDays * DAY) } },
      orderBy: { markedPaidAt: "asc" },
      select: { amount: true, markedPaidAt: true, stage: { select: { title: true, deal: { select: { id: true, number: true, title: true } } } } },
    }),
    db.deal.findMany({ where: { paymentMode: { not: "MANUAL" } }, orderBy: { number: "asc" }, select: { id: true, number: true, title: true } }),
  ]);

  const reconciliation: EscrowReconciliation[] = [];
  for (const deal of escrowDeals) {
    reconciliation.push({ dealId: deal.id, dealNumber: deal.number, title: deal.title, rows: await reconcileOrNull(deal.id) });
  }

  return {
    deals: totals(DealStatus, deals.map((g) => ({ status: g.status, count: g._count._all, sum: g._sum.totalAmount }))),
    stages: totals(StageStatus, stages.map((g) => ({ status: g.status, count: g._count._all, sum: g._sum.amount }))),
    payments: totals(StagePaymentStatus, payments.map((g) => ({ status: g.status, count: g._count._all, sum: g._sum.amount }))),
    discrepancies: stale.map((p) => ({
      dealId: p.stage.deal.id,
      dealNumber: p.stage.deal.number,
      dealTitle: p.stage.deal.title,
      stageTitle: p.stage.title,
      amount: p.amount,
      markedPaidAt: p.markedPaidAt!,
      daysWaiting: Math.floor((now.getTime() - p.markedPaidAt!.getTime()) / DAY),
    })),
    reconciliation,
  };
}

async function reconcileOrNull(dealId: string): Promise<ReconciliationRow[] | null> {
  try {
    return await reconcile(dealId);
  } catch (e) {
    if (!isAppError(e)) throw e;
    logger.warn("reconcile unavailable", { dealId, error: e.message });
    return null;
  }
}

/** Выгрузка для Excel: разделитель «;», BOM, защита от формул (см. csv.ts). */
export async function buildCsv(user: CurrentUser, input: { kind: CsvKind; staleDays: number }): Promise<string> {
  assertOperator(user);
  return toCsv(t.csvHeaders[input.kind], await csvRows(user, input));
}

async function csvRows(user: CurrentUser, input: { kind: CsvKind; staleDays: number }): Promise<CsvCell[][]> {
  switch (input.kind) {
    case "deals":
      return (await db.deal.findMany({ orderBy: { number: "asc" } })).map((d) => [
        d.number,
        d.title,
        t.dealStatus[d.status],
        t.paymentModes[d.paymentMode],
        d.totalAmount,
        csvDateTime(d.createdAt),
        csvDateTime(d.completedAt),
      ]);
    case "stages":
      return (
        await db.stage.findMany({ orderBy: [{ deal: { number: "asc" } }, { order: "asc" }], include: { deal: { select: { number: true } }, payment: true } })
      ).map((s) => [s.deal.number, s.title, s.order, t.stageStatus[s.status], s.amount, t.paymentDue[s.paymentDue], s.payment ? t.paymentStatus[s.payment.status] : ""]);
    case "payments":
      return (
        await db.stagePayment.findMany({
          orderBy: [{ stage: { deal: { number: "asc" } } }, { stage: { order: "asc" } }],
          include: { stage: { select: { title: true, deal: { select: { number: true } } } } },
        })
      ).map((p) => [p.stage.deal.number, p.stage.title, p.amount, t.paymentStatus[p.status], csvDateTime(p.markedPaidAt), csvDateTime(p.confirmedAt)]);
    case "discrepancies":
      return (await buildReport(user, input)).discrepancies.map((d) => [d.dealNumber, d.stageTitle, d.amount, csvDateTime(d.markedPaidAt), d.daysWaiting]);
    case "reconciliation":
      return (await buildReport(user, input)).reconciliation.flatMap((r) =>
        r.rows === null
          ? [[r.dealNumber, "", "", "", "", "", t.report.statementUnavailable]]
          : r.rows.map((row) => [r.dealNumber, t.report.opKinds[row.kind], row.idempotencyKey, row.externalRef, row.ourAmount, row.bankAmount, t.report.reconStatus[row.status]]),
      );
  }
}
