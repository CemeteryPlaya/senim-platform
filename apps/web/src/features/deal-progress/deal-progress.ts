import type { DealStatus } from "@/generated/prisma/enums";

/** Номер текущего шага: 0..4 — шаг из пяти, 5 — все пройдены. */
export type ProgressStep = 0 | 1 | 2 | 3 | 4 | 5;

export type DealProgressView =
  | { kind: "steps"; current: ProgressStep; muted: boolean }
  | { kind: "banner"; tone: "cancelled" | "refunded" };

const CURRENT: Record<Exclude<DealStatus, "CANCELLED" | "REFUNDED">, ProgressStep> = {
  CREATED: 0,
  PAID_HOLD: 1,
  IN_PROGRESS: 1,
  READY: 3,
  ACCEPTED: 4,
  SPLIT_PAYOUT: 5,
};

/**
 * Статус сделки ТЗ п. 9 → вид шкалы (спека 8а). Только отображение, логика статусов не меняется.
 * Открытый спор оставляет шаги видимыми, но серыми; у отменённой и возвращённой сделки шагов нет.
 */
export function dealProgressView(status: DealStatus, hasOpenDispute: boolean): DealProgressView {
  if (status === "CANCELLED") return { kind: "banner", tone: "cancelled" };
  if (status === "REFUNDED") return { kind: "banner", tone: "refunded" };
  return { kind: "steps", current: CURRENT[status], muted: hasOpenDispute };
}
