import type { EscrowStatus } from "@/generated/prisma/enums";

export type EscrowCounters = { deposited: number; released: number; refunded: number; total: number };

/** Статус счёта сделки по суммам движений: одно место, где решается, что значит «пополнен» и «закрыт». */
export function escrowStatusOf({ deposited, released, refunded, total }: EscrowCounters): EscrowStatus {
  const balance = deposited - released - refunded;
  if (deposited > 0 && balance <= 0) return released > 0 ? "CLOSED" : "REFUNDED";
  if (released > 0) return "PARTIALLY_RELEASED";
  return deposited >= total ? "FUNDED" : "OPENED";
}
