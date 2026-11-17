import type { DealStatus } from "@/generated/prisma/enums";

/** Конечные статусы сделки: успешно, отмена, возврат. */
export const ENDED_DEAL: readonly DealStatus[] = ["SPLIT_PAYOUT", "CANCELLED", "REFUNDED"];

/**
 * «Оконченная с офертой»: конечный статус и заключённая оферта (`signedAt` ставится при подписи оферты и остаётся после отмены).
 * Сделка без оферты (отмена до подписи) нигде не считается и без отзыва.
 */
export function isEndedSigned(deal: { status: DealStatus; signedAt: Date | null }): boolean {
  return ENDED_DEAL.includes(deal.status) && deal.signedAt !== null;
}
