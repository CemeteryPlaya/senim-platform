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

/** Режим для новых сделок: из env (оператор в DEMO_MODE переопределяет через PlatformSetting — фаза B). */
export async function activeRailMode(): Promise<RailMode> {
  return env().PAYMENT_RAIL;
}

export const jobHandlers = {} as const;
