import "server-only";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Role as ProtoRole, type Person, type User } from "@/gen/senim/identity/v1/identity_pb";
import type { Role as PrismaRole } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { db, isUniqueViolation, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";

const TO_PRISMA = {
  [ProtoRole.CLIENT]: "CLIENT",
  [ProtoRole.EXECUTOR]: "EXECUTOR",
  [ProtoRole.OPERATOR]: "OPERATOR",
  [ProtoRole.MEASURER]: "MEASURER",
} as const satisfies Partial<Record<ProtoRole, PrismaRole>>;

const TO_PROTO: Record<PrismaRole, ProtoRole> = {
  CLIENT: ProtoRole.CLIENT,
  EXECUTOR: ProtoRole.EXECUTOR,
  OPERATOR: ProtoRole.OPERATOR,
  MEASURER: ProtoRole.MEASURER,
};

/** Роль из identity → роль старой базы. `ROLE_UNSPECIFIED` — ошибка контракта. */
export function roleFromProto(r: ProtoRole): PrismaRole {
  const role = (TO_PRISMA as Partial<Record<ProtoRole, PrismaRole>>)[r];
  if (!role) throw new Error(`identity вернул неизвестную роль: ${r}`);
  return role;
}

export function roleToProto(r: PrismaRole): ProtoRole {
  return TO_PROTO[r];
}

const sameRoles = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/**
 * Проекция пользователя identity в старую таблицу `User` (тот же `id`): на неё ссылаются сделки, заявки и профили.
 * Пишутся только поля пользователя identity: телефон, роль по умолчанию, роли, демо-флаг, блокировка; личность
 * (ФИО, ИИН, контакты) — projectPerson. Обновляются только изменившиеся поля. Строка с тем же телефоном, но другим `id`
 * (dev-база до перехода на identity) — ошибка с записью в лог, а не дубль.
 * `client` — транзакция сида демо (пользователи появляются вместе с остальными данными); по умолчанию — `db`.
 */
export async function projectUser(user: User, client: Tx = db): Promise<void> {
  try {
    await project(user, client);
  } catch (e) {
    // Два параллельных запроса создали одного пользователя: проигравший повторяет, видит строку и сверяет поля.
    // В транзакции повтор невозможен (она прервана ошибкой) — ошибка уходит наверх.
    if (!isUniqueViolation(e) || client !== db) throw e;
    await project(user, client);
  }
}

async function project(user: User, client: Tx): Promise<void> {
  const role = roleFromProto(user.defaultRole);
  const roles = user.roles.map(roleFromProto);
  if (!roles.includes(role)) throw new Error("identity вернул роль по умолчанию вне выданных ролей");
  const blockedAt = user.blockedAt ? timestampDate(user.blockedAt) : null;

  const phoneOwner = await client.user.findUnique({ where: { phone: user.phone }, select: { id: true } });
  if (phoneOwner && phoneOwner.id !== user.id) {
    logger.error("identity.projection.phone_conflict", { userId: user.id });
    return fail.conflict();
  }

  const row = await client.user.findUnique({ where: { id: user.id }, select: { phone: true, role: true, roles: true, isDemo: true, blockedAt: true } });
  if (!row) {
    await client.user.create({ data: { id: user.id, phone: user.phone, role, roles, isDemo: user.isDemo, blockedAt } });
    return;
  }

  const data = {
    ...(row.phone !== user.phone && { phone: user.phone }),
    ...(row.role !== role && { role }),
    ...(!sameRoles(row.roles, roles) && { roles }),
    ...(row.isDemo !== user.isDemo && { isDemo: user.isDemo }),
    ...((row.blockedAt?.getTime() ?? null) !== (blockedAt?.getTime() ?? null) && { blockedAt }),
  };
  if (Object.keys(data).length > 0) await client.user.update({ where: { id: user.id }, data });
}

/** Пусто в ответе identity — поле не указано: в старой базе это null. */
const orNull = (v: string): string | null => (v === "" ? null : v);

/**
 * Проекция личности identity в старую `User`: ФИО, последние 4 цифры ИИН, Instagram и e-mail — их показывают экраны
 * и сверяют страницы (needsIntroduction, hasClientIdentity). Пишутся только изменившиеся поля. Сам ИИН в старой базе
 * больше не хранится: `iinEnc` и `iinHash` не пишутся (ИИН — только в identity, шифртекстом). Строка пользователя уже
 * есть (projectUser при входе); её нет — сбой.
 */
export async function projectPerson(person: Person, client: Tx = db): Promise<void> {
  const row = await client.user.findUnique({ where: { id: person.userId }, select: { fullName: true, iinLast4: true, instagram: true, email: true } });
  if (!row) throw new Error("identity вернул личность пользователя, которого нет в проекции");
  const next = { fullName: orNull(person.fullName), iinLast4: orNull(person.iinLast4), instagram: orNull(person.instagram), email: orNull(person.email) };
  const data = {
    ...(row.fullName !== next.fullName && { fullName: next.fullName }),
    ...(row.iinLast4 !== next.iinLast4 && { iinLast4: next.iinLast4 }),
    ...(row.instagram !== next.instagram && { instagram: next.instagram }),
    ...(row.email !== next.email && { email: next.email }),
  };
  if (Object.keys(data).length > 0) await client.user.update({ where: { id: person.userId }, data });
}

/**
 * Личность из ответа identity на вызов в сессии пользователя `userId`. Нет её или она чужая — сбой контракта: в лог
 * (без значений), человеку — общий текст. Чужие ФИО и контакты в проекцию не попадают.
 */
export function ownPerson(userId: string, person: Person | undefined): Person {
  if (person?.userId === userId) return person;
  logger.error("identity.call_rejected", { reason: person ? "person_of_other_user" : "response_without_person" });
  return fail.unavailable(ru.common.errors.generic);
}
