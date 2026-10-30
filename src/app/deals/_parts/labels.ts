import type { DealStatus, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";
import type { Tone } from "@/ui";

// Цвет статуса — одно место для списка сделок и экрана сделки.

export const DEAL_TONE: Record<DealStatus, Tone> = {
  AWAITING_SIGNATURES: "info",
  AWAITING_DEPOSIT: "info",
  IN_PROGRESS: "accent",
  DISPUTE: "danger",
  COMPLETED: "success",
  CANCELLED: "neutral",
  TERMINATED: "neutral",
};

export const STAGE_TONE: Record<StageStatus, Tone> = {
  PENDING: "neutral",
  IN_PROGRESS: "accent",
  SUBMITTED: "warning",
  REWORK: "warning",
  ACCEPTED: "success",
  CLOSED: "success",
};

export const PAYMENT_TONE: Record<StagePaymentStatus, Tone> = {
  DUE: "warning",
  MARKED_PAID: "info",
  CONFIRMED: "success",
};
