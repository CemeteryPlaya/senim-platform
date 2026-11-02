import "server-only";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { db, transaction } from "@/platform/db";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { contactsInputSchema, type ContactsInput } from "./instagram";
import { actorOf, type CurrentUser } from "./session";

/**
 * Контакты своего профиля (заказчик и мастер): телефон — номер входа (не меняется здесь), Instagram — по желанию
 * (другой стороне сделки виден только после заключения оферты, companies.dealContacts); e-mail — по желанию,
 * только для копии подписанного акта (documents), другой стороне не показывается.
 */
export type OwnContacts = { phone: string; instagram: string | null; email: string | null };

const OWN = { phone: true, instagram: true, email: true } as const;

function requireParty(user: CurrentUser): void {
  if (user.role !== "CLIENT" && user.role !== "EXECUTOR") fail.forbidden(ru.identity.contacts.onlyParties);
}

export async function getOwnContacts(user: CurrentUser): Promise<OwnContacts> {
  return db.user.findUniqueOrThrow({ where: { id: user.id }, select: OWN });
}

/**
 * Сохранить Instagram и e-mail (если передан). Журнал — без значений (только «указан / не указан»): контакты
 * раскрываются по правилу оферты, а не через журнал. Повтор того же значения журнал не пишет.
 */
export async function updateContacts(user: CurrentUser, raw: ContactsInput): Promise<OwnContacts> {
  requireParty(user);
  const input = parseInput(contactsInputSchema, raw);
  return transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: OWN });
    const after = await tx.user.update({ where: { id: user.id }, data: input, select: OWN });
    const changes = [
      { field: "instagram", action: "user.instagram_changed" },
      { field: "email", action: "user.email_changed" },
    ] as const;
    for (const { field, action } of changes) {
      if (before[field] === after[field]) continue;
      await recordAudit(tx, {
        actor: actorOf(user),
        action,
        entity: { type: "user", id: user.id },
        scope: `user:${user.id}`,
        before: { set: before[field] !== null },
        after: { set: after[field] !== null },
      });
    }
    return after;
  });
}
