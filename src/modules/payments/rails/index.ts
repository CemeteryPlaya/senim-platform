import type { PaymentRail, RailMode } from "../rail";
import { bankRail } from "./bank";
import { escrowSimulatorRail } from "./escrow-simulator";
import { manualRail } from "./manual";

/** Рельс по режиму. */
export function railFor(mode: RailMode): PaymentRail {
  switch (mode) {
    case "manual":
      return manualRail;
    case "escrow-simulator":
      return escrowSimulatorRail;
    case "bank":
      return bankRail;
  }
}
