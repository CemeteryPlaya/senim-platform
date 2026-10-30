import "server-only";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { bankRail } from "./rails/bank";
import { manualRail } from "./rails/manual";
import type { PaymentRail, RailMode } from "./rail";

export type * from "./rail";

/** Рельс по режиму. escrow-simulator реализует deal-core-engineer (фаза B). */
export function railFor(mode: RailMode): PaymentRail {
  switch (mode) {
    case "manual":
      return manualRail;
    case "bank":
      return bankRail;
    case "escrow-simulator":
      return fail.unavailable("Симулятор эскроу ещё не реализован");
  }
}

/** Режим для новых сделок: env, в DEMO_MODE — переопределение оператором (PlatformSetting, фаза B). */
export async function activeRailMode(): Promise<RailMode> {
  return env().PAYMENT_RAIL;
}

export type ReconciliationRow = {
  dealId: string;
  idempotencyKey: string | null;
  externalRef: string | null;
  kind: "DEPOSIT" | "RELEASE" | "REFUND";
  ourAmount: number | null; // по PaymentOperation
  bankAmount: number | null; // по выписке рельса
  status: "MATCHED" | "MISSING_IN_BANK" | "MISSING_IN_JOURNAL" | "AMOUNT_MISMATCH";
};

/** operator → payments: сверка операций сделки с выпиской рельса. Реализацию экспортирует deal-core-engineer. */
export type Reconcile = (dealId: string) => Promise<ReconciliationRow[]>;

export const jobHandlers = {} as const;
