import type { PaymentMode } from "@/generated/prisma/enums";
import { railFor, type RailMode, type Reconcile } from "@/modules/payments";
import { db } from "@/platform/db";
import { matchStatement } from "../reconcile";

const RAIL_OF: Record<PaymentMode, RailMode> = { MANUAL: "manual", ESCROW_SIMULATOR: "escrow-simulator", BANK: "bank" };

// INTEGRATOR: заменить на payments.reconcile, когда deal-core-engineer его экспортирует; файл удалить
// (чистую matchStatement можно перенести в payments). Выписку берёт у рельса сделки: если рельс
// недоступен (симулятор ещё не реализован), ошибка UNAVAILABLE уходит вызывающему.
export const reconcile: Reconcile = async (dealId) => {
  const escrow = await db.escrowAccount.findUnique({ where: { dealId }, select: { rail: true, externalId: true } });
  if (!escrow) return [];
  const operations = await db.paymentOperation.findMany({
    where: { dealId },
    orderBy: { createdAt: "asc" },
    select: { dealId: true, kind: true, amount: true, idempotencyKey: true, externalRef: true, status: true },
  });
  const statement = await railFor(RAIL_OF[escrow.rail]).getStatement(escrow.externalId);
  return matchStatement(dealId, operations, statement);
};
