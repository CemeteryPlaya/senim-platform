import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import { randomToken, sha256Hex } from "@/platform/crypto";
import { fail } from "@/platform/errors";
import type { Actor } from "@/modules/audit";

export const SESSION_COOKIE = "senim_session";
const SESSION_TTL_DAYS = 30;

export type CurrentUser = {
  id: string;
  role: Role;
  phone: string;
  fullName: string | null;
  isDemo: boolean;
  /** Профиль исполнителя, если role = EXECUTOR. */
  executor: { id: string; publicNumber: number; status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

/** Создаёт сессию и ставит httpOnly-cookie. Вызывать из Server Action или route handler. */
export async function startSession(userId: string, userAgent?: string): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db.session.create({ data: { userId, tokenHash: sha256Hex(token), expiresAt, userAgent: userAgent?.slice(0, 300) } });
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
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({ where: { tokenHash: sha256Hex(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  store.delete(SESSION_COOKIE);
}

/** Отзывает все сессии пользователя (блокировка, смена телефона). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Текущий пользователь по cookie; один запрос к БД на HTTP-запрос. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { include: { executorProfile: { select: { id: true, publicNumber: true, status: true } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.blockedAt) return null;
  const { user } = session;
  return {
    id: user.id,
    role: user.role,
    phone: user.phone,
    fullName: user.fullName,
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

/** Исполнитель, подтверждённый оператором. */
export async function requireApprovedExecutor(): Promise<CurrentUser & { executor: NonNullable<CurrentUser["executor"]> }> {
  const user = await requireUser("EXECUTOR");
  if (!user.executor || user.executor.status !== "APPROVED") return fail.forbidden("Профиль ещё не подтверждён оператором");
  return { ...user, executor: user.executor };
}

export function actorOf(user: Pick<CurrentUser, "id" | "role">): Actor {
  return { kind: "user", id: user.id, role: user.role };
}
