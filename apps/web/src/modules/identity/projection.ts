import "server-only";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Role as ProtoRole, type User } from "@/gen/senim/identity/v1/identity_pb";
import type { Role as PrismaRole } from "@/generated/prisma/enums";
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
 * Пишутся только поля identity: телефон, роль по умолчанию, роли, демо-флаг, блокировка; остальное (ФИО, ИИН,
 * контакты) принадлежит старой базе. Обновляются только изменившиеся поля. Строка с тем же телефоном, но другим `id`
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
