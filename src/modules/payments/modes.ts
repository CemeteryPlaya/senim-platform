import type { PaymentMode } from "@/generated/prisma/enums";
import type { RailMode } from "./rail";

// Режим в env и настройках — строкой ("escrow-simulator"), в БД — enum (ESCROW_SIMULATOR).
const TO_PAYMENT_MODE = {
  manual: "MANUAL",
  "escrow-simulator": "ESCROW_SIMULATOR",
  bank: "BANK",
} as const satisfies Record<RailMode, PaymentMode>;

const TO_RAIL_MODE = {
  MANUAL: "manual",
  ESCROW_SIMULATOR: "escrow-simulator",
  BANK: "bank",
} as const satisfies Record<PaymentMode, RailMode>;

export const RAIL_MODES = Object.keys(TO_PAYMENT_MODE) as RailMode[];

export const paymentModeOf = (mode: RailMode): PaymentMode => TO_PAYMENT_MODE[mode];
export const railModeOf = (mode: PaymentMode): RailMode => TO_RAIL_MODE[mode];
