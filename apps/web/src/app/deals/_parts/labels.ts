import type { DealStatus } from "@/generated/prisma/enums";
import type { Tone } from "@/ui";

// Цвет статуса сделки (ТЗ п. 9) — одно место для списка сделок, главных экранов и карточки сделки.
// Цвет только в помощь: у метки всегда есть текст ru.deal.status.

export const DEAL_TONE: Record<DealStatus, Tone> = {
  CREATED: "info",
  PAID_HOLD: "accent",
  IN_PROGRESS: "accent",
  READY: "warning",
  ACCEPTED: "success",
  SPLIT_PAYOUT: "success",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
};

/** Сделка ещё идёт: её показывают главные экраны. Завершённые, отменённые и с возвратом — в «Сделках». */
export const ACTIVE_DEAL: ReadonlySet<DealStatus> = new Set(["CREATED", "PAID_HOLD", "IN_PROGRESS", "READY", "ACCEPTED"]);
