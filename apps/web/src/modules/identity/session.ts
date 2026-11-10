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
import { logger } from "@/platform/logger";
import { rpcErrorCode } from "@/platform/rpc";
import { projectUser, roleFromProto } from "./projection";
import { identity } from "./remote";
import { identityFailure } from "./remote-errors";
import { sessionCookieName, sessionCookieOptions } from "./session-cookie";
import { loginHref } from "./return-to";
import { introductionHref, needsIntroduction } from "./introduction";
import { activeRoleOf, isStaffRole, roleToSwitch, STAFF_ROLES, switchRoleHref } from "./roles";

/** Имя cookie в контуре dev (в тестах и локально); в остальных контурах — `sessionCookieName()` с префиксом __Host-. */
export const SESSION_COOKIE = "senim_session";
const SESSION_TTL_DAYS = 30;
/** Токен сессии — base64url без «=» от 32 байт (43 символа); иначе identity ответит session_token_invalid. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

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
  return (await cookies()).get(sessionCookieName())?.value;
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
  store.set(sessionCookieName(), token, { ...sessionCookieOptions(), expires: expiresAt });
}

/** Отзывает текущую сессию и удаляет cookie. */
export async function endSession(): Promise<void> {
  const token = await currentToken();
  if (token) await revokeToken(token);
  (await cookies()).delete(sessionCookieName());
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

/**
 * Authenticate по cookie: один вызов identity на HTTP-запрос (cache). `null` — гость: нет cookie, токен не того вида
 * или identity ответил `session_invalid` (простой, срок, отзыв, блокировка). Cookie здесь не удаляется: в Server Component
 * это невозможно, удаление — в Server Action / route handler. Недоступный identity — ошибка «сервис недоступен»,
 * cookie остаётся: человек не «выходит» сам.
 */
const authenticated = cache(async () => {
  const token = await currentToken();
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  try {
    const res = await identity().authenticate({ sessionToken: token });
    if (!res.user || !res.session) {
      logger.error("identity.call_rejected", { reason: "authenticate_without_user" });
      return fail.unavailable(ru.common.errors.generic);
    }
    return { user: res.user, session: res.session, accessToken: res.accessToken };
  } catch (e) {
    if (rpcErrorCode(e) === "session_invalid") return null;
    return identityFailure(e);
  }
});

/** Текущий пользователь по cookie: сессию проверяет identity, остальные поля — из старой базы. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const auth = await authenticated();
  if (!auth) return null;
  const { user, session } = auth;
  await projectUser(user);
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { executorProfile: { select: { id: true, publicNumber: true, status: true } } },
  });
  return {
    id: row.id,
    role: activeRoleOf(row.roles, row.role, roleFromProto(session.activeRole)),
    roles: row.roles,
    phone: row.phone,
    fullName: row.fullName,
    iinLast4: row.iinLast4,
    isDemo: row.isDemo,
    executor: row.executorProfile,
  };
});

/**
 * Внутренний токен для вызовов сервисов v2 от имени текущего пользователя (короткоживущий, Ed25519);
 * `null` — гость. Тот же вызов Authenticate, что и в getCurrentUser. Токен не логировать и не отдавать в браузер.
 */
export async function getAccessToken(): Promise<string | null> {
  return (await authenticated())?.accessToken ?? null;
}

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
