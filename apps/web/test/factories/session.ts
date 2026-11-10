import type { Role } from "@/generated/prisma/enums";
// Прямые импорты файлов, а не index.ts: index тянет next/headers раньше, чем тест успеет его подменить.
// eslint-disable-next-line no-restricted-imports
import { roleToProto } from "@/modules/identity/projection";
// eslint-disable-next-line no-restricted-imports
import { newSessionToken, sessionCookieName } from "@/modules/identity/session-cookie";
import { db } from "@/platform/db";
import { identityFake } from "../stubs/identity";
import { putCookie } from "./identity";

/**
 * Пользователь старой базы появляется в подделке identity с теми же id, телефоном, ролями и демо-флагом
 * (без этого identity «не знает» человека, которого тест создал фабрикой напрямую в старой базе).
 */
export async function mirrorUser(userId: string): Promise<void> {
  if (identityFake.hasUser(userId)) return;
  const row = await db.user.findUniqueOrThrow({ where: { id: userId } });
  identityFake.addUser({
    id: row.id,
    phone: row.phone,
    defaultRole: roleToProto(row.role),
    roles: row.roles.map(roleToProto),
    isDemo: row.isDemo,
    blocked: row.blockedAt !== null,
  });
}

/** Все пользователи старой базы — в подделку (сид демо создаёт их напрямую). */
export async function mirrorAllUsers(): Promise<void> {
  for (const { id } of await db.user.findMany({ select: { id: true } })) await mirrorUser(id);
}

/**
 * Вошёл пользователь: сессия в подделке identity и cookie в «браузере» теста — так, как их оставляет настоящий вход.
 * Заменяет прежний `startSession`. `role` — активная роль сессии (по умолчанию — роль по умолчанию пользователя).
 */
export async function signInAs(user: { id: string }, role?: Role): Promise<string> {
  await mirrorUser(user.id);
  const token = newSessionToken();
  identityFake.signIn(user.id, token, role ? roleToProto(role) : undefined);
  putCookie(sessionCookieName(), token);
  return token;
}

