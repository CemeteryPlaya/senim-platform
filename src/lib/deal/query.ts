import type { Prisma } from "@/generated/prisma/client";

export const dealInclude = {
  client: true,
  master: { include: { master: true } },
  stages: { orderBy: { order: "asc" } },
  signatures: { orderBy: { signedAt: "asc" } },
  escrow: true,
  transactions: { orderBy: { createdAt: "asc" } },
  events: { orderBy: { createdAt: "asc" }, include: { actor: true } },
  disputes: { orderBy: { createdAt: "desc" }, include: { openedBy: true } },
} satisfies Prisma.DealInclude;

export type DealFull = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

export type Viewer = "CLIENT" | "MASTER" | "ADMIN";

export function moneyOf(deal: Pick<DealFull, "escrow" | "transactions" | "amount">) {
  const sum = (type: string) => deal.transactions.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
  const funded = deal.escrow?.funded ?? 0;
  const releasedGross = deal.escrow?.released ?? 0;
  const refunded = deal.escrow?.refunded ?? 0;
  return {
    funded,
    frozen: funded - releasedGross - refunded,
    toMaster: sum("RELEASE"),
    commission: sum("COMMISSION"),
    refunded,
  };
}
