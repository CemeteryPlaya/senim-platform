import type { DocumentKind, SignParty } from "@/generated/prisma/enums";
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

/**
 * Виды документов, которые видят стороны сделки. Расписка на раскрытие — бумага для банка с полными ИИН/БИН
 * и IBAN: её видит только оператор (ни в списке, ни по id, ни по ссылке).
 */
export const PARTY_KINDS: readonly DocumentKind[] = ["CONTRACT", "ACCEPTANCE_ACT", "MONEY_STATEMENT"];
export const OPERATOR_KINDS: readonly DocumentKind[] = [...PARTY_KINDS, "RELEASE_RECEIPT"];

export const readableKinds = (user: Pick<CurrentUser, "role">): readonly DocumentKind[] => (user.role === "OPERATOR" ? OPERATOR_KINDS : PARTY_KINDS);

/** Конкретный документ: сторона или оператор, и вид документа ему доступен. */
export function canReadDocument(user: Pick<CurrentUser, "id" | "role">, doc: { kind: DocumentKind; deal: { clientId: string; executor: { userId: string } } }): boolean {
  return canRead(user, doc.deal) && readableKinds(user).includes(doc.kind);
}
