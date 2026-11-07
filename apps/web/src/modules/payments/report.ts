import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { computeDealMoney } from "./money";

/**
 * Отчёт оператора «доход платформы» (защита сделки 2% + гарантия оплаты 4%) — только из журнала:
 * подтверждённые SPLIT_PLATFORM за период. Разбивка — той же формулой computeDealMoney от цены X или,
 * при разделе по спору, от доли мастера Y. Сумма разбивки всегда равна операции журнала (проверено тестом).
 */

export type IncomeRow = {
  transactionId: string;
  dealId: string;
  dealNumber: number;
  settledAt: Date;
  protectionTiyn: bigint;
  guaranteeTiyn: bigint;
  totalTiyn: bigint;
  isTest: boolean;
};

export type IncomeReport = { rows: IncomeRow[]; protectionTiyn: bigint; guaranteeTiyn: bigint; totalTiyn: bigint };

export async function platformIncomeReport(operator: CurrentUser, period: { from: Date; to: Date }): Promise<IncomeReport> {
  if (operator.role !== "OPERATOR") return fail.forbidden();
  const ops = await db.moneyTransaction.findMany({
    where: { type: "SPLIT_PLATFORM", status: "SUCCEEDED", settledAt: { gte: period.from, lt: period.to } },
    orderBy: { seq: "asc" },
    include: {
      deal: { select: { number: true, priceTiyn: true } },
      parent: { select: { dispute: { select: { masterShareTiyn: true } } } },
    },
  });
  const rows = ops.map((op): IncomeRow => {
    const share = op.parent?.dispute?.masterShareTiyn ?? op.deal.priceTiyn;
    const m = computeDealMoney(share);
    return {
      transactionId: op.id,
      dealId: op.dealId,
      dealNumber: op.deal.number,
      settledAt: op.settledAt!,
      protectionTiyn: m.protectionTiyn,
      guaranteeTiyn: m.guaranteeTiyn,
      totalTiyn: op.amountTiyn,
      isTest: op.isTest,
    };
  });
  const total = (pick: (r: IncomeRow) => bigint) => rows.reduce((acc, r) => acc + pick(r), 0n);
  return { rows, protectionTiyn: total((r) => r.protectionTiyn), guaranteeTiyn: total((r) => r.guaranteeTiyn), totalTiyn: total((r) => r.totalTiyn) };
}
