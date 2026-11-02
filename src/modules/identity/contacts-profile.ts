import "server-only";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { db, transaction } from "@/platform/db";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { contactsInputSchema, type ContactsInput } from "./instagram";
import { actorOf, type CurrentUser } from "./session";

/**
 * Контакты своего профиля (заказчик и мастер): телефон — номер входа (не меняется здесь), Instagram — по желанию.
 * Другой стороне сделки они видны только после заключения оферты (companies.dealContacts).
 */
export type OwnContacts = { phone: string; instagram: string | null };

function requireParty(user: CurrentUser): void {
  if (user.role !== "CLIENT" && user.role !== "EXECUTOR") fail.forbidden(ru.identity.contacts.onlyParties);
}

export async function getOwnContacts(user: CurrentUser): Promise<OwnContacts> {
  return db.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true, instagram: true } });
}

/**
 * Сохранить Instagram. Журнал — без значения (только «указан / не указан»): контакт раскрывается сторонам
 * сделки по правилу оферты, а не через журнал. Повтор того же значения журнал не пишет.
 */
export async function updateContacts(user: CurrentUser, raw: ContactsInput): Promise<OwnContacts> {
  requireParty(user);
  const { instagram } = parseInput(contactsInputSchema, raw);
  return transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { instagram: true } });
    const after = await tx.user.update({ where: { id: user.id }, data: { instagram }, select: { phone: true, instagram: true } });
    if (before.instagram !== instagram) {
      await recordAudit(tx, {
        actor: actorOf(user),
        action: "user.instagram_changed",
        entity: { type: "user", id: user.id },
        scope: `user:${user.id}`,
        before: { set: before.instagram !== null },
        after: { set: instagram !== null },
      });
    }
    return after;
  });
}
