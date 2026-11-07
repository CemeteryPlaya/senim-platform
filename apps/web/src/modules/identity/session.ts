import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, type Actor } from "@/modules/audit";
import { db, transaction, type Tx } from "@/platform/db";
import { randomToken, sha256Hex } from "@/platform/crypto";
import { expectOneUpdated, fail } from "@/platform/errors";
import { loginHref } from "./return-to";
import { introductionHref, needsIntroduction } from "./introduction";
import { activeRoleOf, isStaffRole, roleToSwitch, STAFF_ROLES, switchRoleHref } from "./roles";

export const SESSION_COOKIE = "senim_session";
const SESSION_TTL_DAYS = 30;
/** lastSeenAt пишется не чаще раза в N минут: иначе каждый запрос страницы — запись в БД. */
const LAST_SEEN_THROTTLE_MIN = 10;

export type CurrentUser = {
  id: string;
  /** Активная роль: в ней человек действует в этой сессии. Все проверки прав — по ней (ADR-004). */
  role: Role;
  /** Выданные роли; активная — одна из них. */
  roles: Role[];
  phone: string;
  fullName: string | null;
  /** Последние 4 цифры ИИН аккаунта (сам ИИН — только зашифрованным в БД); null — знакомство не пройдено. */
  iinLast4: string | null;
  isDemo: boolean;
  /**
   * Профиль исполнителя этого аккаунта, если он есть (в любой активной роли: экран регистрации
   * и история сделок). Права исполнителя — только при role = EXECUTOR.
   */
  executor: { id: string; publicNumber: number; status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

async function currentToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

async function revokeToken(token: string): Promise<void> {
  await db.session.updateMany({ where: { tokenHash: sha256Hex(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Создаёт сессию и ставит httpOnly-cookie. Прежняя сессия этого браузера отзывается.
 * Активная роль сессии фиксируется ролью по умолчанию на момент входа: переключение роли
 * на другом устройстве не меняет роль этой сессии. asRole — войти сразу в другую выданную роль
 * (демо-вход шага показа банку); невыданная роль — FORBIDDEN. Вызывать из Server Action или route handler.
 */
export async function startSession(userId: string, userAgent?: string, asRole?: Role): Promise<void> {
  const { role, roles } = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, roles: true } });
  if (asRole && !roles.includes(asRole)) return fail.forbidden(ru.identity.switchRole.notGranted);

  const previous = await currentToken();
  if (previous) await revokeToken(previous);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db.session.create({ data: { userId, activeRole: asRole ?? role, tokenHash: sha256Hex(token), expiresAt, userAgent: userAgent?.slice(0, 300) } });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Отзывает текущую сессию и удаляет cookie. */
export async function endSession(): Promise<void> {
  const token = await currentToken();
  if (token) await revokeToken(token);
  (await cookies()).delete(SESSION_COOKIE);
}

/** Отзывает все сессии пользователя (блокировка, смена телефона). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** «Выйти на всех устройствах»: отзывает все сессии текущего пользователя и удаляет cookie. */
export async function signOutEverywhere(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await revokeAllSessions(user.id);
  await endSession();
}

/** Текущий пользователь по cookie; один запрос к БД на HTTP-запрос. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await currentToken();
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { include: { executorProfile: { select: { id: true, publicNumber: true, status: true } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.blockedAt) return null;

  const staleBefore = new Date(Date.now() - LAST_SEEN_THROTTLE_MIN * 60_000);
  if (session.lastSeenAt < staleBefore) {
    // Условие в where делает запись идемпотентной при параллельных запросах.
    await db.session.updateMany({ where: { id: session.id, lastSeenAt: { lt: staleBefore } }, data: { lastSeenAt: new Date() } });
  }

  const { user } = session;
  return {
    id: user.id,
    role: activeRoleOf(user.roles, user.role, session.activeRole),
    roles: user.roles,
    phone: user.phone,
    fullName: user.fullName,
    iinLast4: user.iinLast4,
    isDemo: user.isDemo,
    executor: user.executorProfile,
  };
});

/** Для Server Actions и сервисов: пользователь с одной из ролей, иначе ошибка. */
export async function requireUser(...roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) return fail.unauthenticated();
  if (roles.length > 0 && !roles.includes(user.role)) return fail.forbidden();
  return user;
}

/**
 * Для страниц: пользователь с одной из ролей, иначе переход на /login с возвратом на `returnTo`
 * (адрес текущей страницы — страница знает свои params). Нужная роль у человека есть, но не активна —
 * на страницу переключения роли с тем же возвратом. Роли нет вовсе — вход с reason=role:
 * экран входа предложит выйти и войти под нужным номером.
 */
export async function requireUserPage(returnTo: string, ...roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(returnTo));
  if (roles.length > 0 && !roles.includes(user.role)) {
    const to = roleToSwitch(user, roles);
    redirect(to ? switchRoleHref(to, returnTo) : loginHref(returnTo, "role"));
  }
  requireIntroduced(user, returnTo);
  return user;
}

/**
 * Для страниц заказчика и исполнителя, которые берут пользователя через getCurrentUser: без пройденного
 * знакомства (ФИО и ИИН, №26) — на знакомство с возвратом сюда.
 */
export function requireIntroduced(user: CurrentUser, returnTo: string): void {
  if (needsIntroduction(user)) redirect(introductionHref(returnTo));
}

/**
 * Переключение активной роли этой сессии (ADR-004). Роль должна быть выдана (проверка по БД, а не по сессии:
 * отозванную роль не выбрать). Роль по умолчанию для следующего входа — тоже она. Строка пользователя
 * блокируется: двойной клик выполняется последовательно, второй вызов видит роль уже активной и ничего не меняет.
 */
export async function switchRole(user: Pick<CurrentUser, "id">, role: Role): Promise<void> {
  const token = await currentToken();
  if (!token) return fail.unauthenticated();
  await transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ role: Role; roles: Role[] }[]>`
      SELECT role, roles::text[] AS roles FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    if (!row || !row.roles.includes(role)) return fail.forbidden(ru.identity.switchRole.notGranted);
    const session = await tx.session.findUnique({ where: { tokenHash: sha256Hex(token) }, select: { id: true, userId: true, activeRole: true } });
    if (!session || session.userId !== user.id) return fail.unauthenticated();

    const current = activeRoleOf(row.roles, row.role, session.activeRole);
    if (current === role) return;
    expectOneUpdated(await tx.session.updateMany({ where: { id: session.id, activeRole: session.activeRole }, data: { activeRole: role } }));
    await tx.user.update({ where: { id: user.id }, data: { role } });
    await recordAudit(tx, {
      actor: actorOf({ id: user.id, role: current }),
      action: "user.role_switched",
      entity: { type: "user", id: user.id },
      before: { role: current },
      after: { role },
    });
  });
}

/**
 * Выдаёт роль в транзакции вызывающего (анкета исполнителя, «Стать заказчиком»). Уже выданная — без изменений
 * (условие в where делает вызов идемпотентным при двойной отправке); оператору роли не добавляются.
 * Возвращает true, если роль выдана сейчас.
 */
export async function grantRole(tx: Tx, user: Pick<CurrentUser, "id" | "role">, role: Role): Promise<boolean> {
  if (isStaffRole(role)) return fail.forbidden();
  const granted = await tx.user.updateMany({
    where: { id: user.id, NOT: [{ roles: { has: role } }, ...STAFF_ROLES.map((s) => ({ roles: { has: s } }))] },
    data: { roles: { push: role } },
  });
  if (granted.count === 0) return false;
  await recordAudit(tx, { actor: actorOf(user), action: "user.role_granted", entity: { type: "user", id: user.id }, after: { role } });
  return true;
}

/**
 * «Стать заказчиком» из профиля исполнителя (ADR-004): у роли заказчика нет привилегий над чужими данными,
 * поэтому она выдаётся сразу, без модерации, и сессия переходит в неё. Повтор ничего не меняет.
 */
export async function becomeClient(user: CurrentUser): Promise<void> {
  if (user.role !== "EXECUTOR") return fail.forbidden();
  await transaction((tx) => grantRole(tx, user, "CLIENT"));
  await switchRole(user, "CLIENT");
}

export function actorOf(user: Pick<CurrentUser, "id" | "role">): Actor {
  return { kind: "user", id: user.id, role: user.role };
}
