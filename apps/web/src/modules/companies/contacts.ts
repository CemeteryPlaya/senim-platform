import "server-only";
import { ru } from "@/i18n/ru";
import { formatPhone, type CurrentUser } from "@/modules/identity";
import { db, type Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { chatPartyOf, type ChatParty } from "./chat-policy";
import { contactStage, seesPartyContacts } from "./contacts-policy";

/**
 * Контакты другой стороны (ТЗ п. 3): телефон и Instagram — после заключения оферты, только сторонам
 * сделки. Правило — таблица CONTACTS (contacts-policy.ts); здесь только чтение.
 * of — чьи это контакты; phone — E.164 для ссылки tel:, phoneDisplay — для показа.
 */
export type PartyContacts = { of: "client" | "executor"; phone: string; phoneDisplay: string; instagram: string | null };

export type DealSides = { clientId: string; executorUserId: string; signedAt: Date | null };

/** Контакты другой стороны для party; null — по таблице показывать нечего. */
export async function partyContactsFor(client: Db, party: ChatParty, sides: DealSides): Promise<PartyContacts | null> {
  if (!seesPartyContacts(contactStage(sides), party)) return null;
  const of = party === "client" ? "executor" : "client";
  const other = await client.user.findUniqueOrThrow({
    where: { id: of === "client" ? sides.clientId : sides.executorUserId },
    select: { phone: true, instagram: true },
  });
  return { of, phone: other.phone, phoneDisplay: formatPhone(other.phone), instagram: other.instagram };
}

/**
 * «Контакты другой стороны» на экране сделки. Сторона сделки — контакты после оферты (до неё — null);
 * оператор — null (телефоны он видит в своей панели); чужая или несуществующая сделка — NOT_FOUND.
 */
export async function dealContacts(user: CurrentUser, dealId: string): Promise<PartyContacts | null> {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { clientId: true, signedAt: true, executor: { select: { userId: true } } } });
  const sides = deal ? { clientId: deal.clientId, executorUserId: deal.executor.userId, signedAt: deal.signedAt } : null;
  const party = sides ? chatPartyOf(user, sides) : null;
  if (!sides || !party) return fail.notFound(ru.companies.chat.contacts.errors.dealNotFound);
  return partyContactsFor(db, party, sides);
}
