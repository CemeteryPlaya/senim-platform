import type { SignParty } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";

/** Кем пользователь приходится сделке: сторона договора или никто. Оператор — не сторона. */
export function partyOf(user: Pick<CurrentUser, "id">, deal: { clientId: string; executor: { userId: string } }): SignParty | null {
  if (user.id === deal.clientId) return "CLIENT";
  if (user.id === deal.executor.userId) return "EXECUTOR";
  return null;
}

/** Документы сделки видят её стороны и оператор. */
export function canRead(user: Pick<CurrentUser, "id" | "role">, deal: { clientId: string; executor: { userId: string } }): boolean {
  return user.role === "OPERATOR" || partyOf(user, deal) !== null;
}
