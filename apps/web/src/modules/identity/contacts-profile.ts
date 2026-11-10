import "server-only";
import { randomUUID } from "node:crypto";
import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { contactsInputSchema, type ContactsInput } from "./instagram";
import { ownPerson, projectPerson } from "./projection";
import { identity } from "./remote";
import { identityFailure, retriedOnce } from "./remote-errors";
import { currentSessionToken, type CurrentUser } from "./session";

/**
 * Контакты своего профиля (заказчик и мастер): телефон — номер входа (не меняется здесь), Instagram — по желанию
 * (другой стороне сделки виден только после заключения оферты, companies.dealContacts); e-mail — по желанию,
 * только для копии подписанного акта (documents), другой стороне не показывается. Хранит их identity; старая
 * `User` — проекция (projectPerson).
 */
export type OwnContacts = { phone: string; instagram: string | null; email: string | null };

function requireParty(user: CurrentUser): void {
  if (user.role !== "CLIENT" && user.role !== "EXECUTOR") fail.forbidden(ru.identity.contacts.onlyParties);
}

const contactsOf = (user: CurrentUser, person: { instagram: string; email: string }): OwnContacts => ({
  phone: user.phone,
  instagram: person.instagram || null,
  email: person.email || null,
});

/** Личность из identity (GetProfile) в сессии этого браузера, с записью в проекцию. */
async function ownProfile(user: CurrentUser) {
  const sessionToken = await currentSessionToken();
  let res;
  try {
    res = await identity().getProfile({ sessionToken });
  } catch (e) {
    return identityFailure(e);
  }
  const person = ownPerson(user.id, res.person);
  await projectPerson(person);
  return person;
}

export async function getOwnContacts(user: CurrentUser): Promise<OwnContacts> {
  return contactsOf(user, await ownProfile(user));
}

/**
 * Сохранить Instagram и e-mail (если передан). identity принимает оба поля как полное новое состояние (пусто —
 * «не указан»), поэтому не переданный e-mail берётся текущим из identity — иначе он стёрся бы. Формат проверяется
 * здесь же схемой (ошибки у полей без вызова) и ещё раз в identity. Журнал (только «указан / не указан», без
 * значений; то же значение ещё раз — без записи) ведёт identity.
 */
export async function updateContacts(user: CurrentUser, raw: ContactsInput): Promise<OwnContacts> {
  requireParty(user);
  const input = parseInput(contactsInputSchema, raw);
  const email = input.email === undefined ? (await ownProfile(user)).email : (input.email ?? "");
  const sessionToken = await currentSessionToken();
  const request = { sessionToken, instagram: input.instagram ?? "", email, idempotencyKey: randomUUID() };
  const res = await retriedOnce(() => identity().updateContacts(request));
  const person = ownPerson(user.id, res.person);
  await projectPerson(person);
  return contactsOf(user, person);
}
