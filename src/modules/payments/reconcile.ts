import { db } from "@/platform/db";
import { railModeOf } from "./modes";
import { reconcileEntries, type ReconciliationRow } from "./reconcile-entries";
import { railFor } from "./rails";

/** operator → payments: сверка операций сделки с выпиской рельса. */
export type Reconcile = (dealId: string) => Promise<ReconciliationRow[]>;

/** Журнал платформы против выписки банка. У сделки без счёта (manual) сверять нечего. */
export const reconcile: Reconcile = async (dealId) => {
  const account = await db.escrowAccount.findUnique({ where: { dealId } });
  if (!account) return [];
  const [ops, statement] = await Promise.all([
    db.paymentOperation.findMany({ where: { dealId }, orderBy: { createdAt: "asc" } }),
    railFor(railModeOf(account.rail)).getStatement(account.externalId),
  ]);
  return reconcileEntries(dealId, ops, statement);
};
