import "server-only";
import type { LegalForm, Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { startSession } from "./session";

/**
 * Демо-персоны: вход одним нажатием, только при DEMO_MODE=true и только пользователем с isDemo.
 * В MVP switchUser ставил cookie с любым id — здесь сервер проверяет и флаг, и isDemo,
 * а сессия создаётся обычным путём (startSession), без доверия к данным клиента.
 */

export type DemoPersona = {
  id: string;
  role: Role;
  fullName: string | null;
  phone: string;
  executor: { publicNumber: number; legalForm: LegalForm; legalName: string; status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

const ROLE_ORDER: Record<Role, number> = { OPERATOR: 0, CLIENT: 1, EXECUTOR: 2 };

export async function listDemoPersonas(): Promise<DemoPersona[]> {
  if (!env().DEMO_MODE) return [];
  const users = await db.user.findMany({
    where: { isDemo: true, blockedAt: null },
    select: {
      id: true,
      role: true,
      fullName: true,
      phone: true,
      executorProfile: { select: { publicNumber: true, legalForm: true, legalName: true, status: true } },
    },
    orderBy: { phone: "asc" },
  });
  return users
    .map(({ executorProfile, ...u }) => ({ ...u, executor: executorProfile }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.executor?.publicNumber ?? 0) - (b.executor?.publicNumber ?? 0));
}

/** Вход персоной; возвращает роль и статус профиля — чтобы выбрать экран после входа. */
export async function loginAsDemoPersona(
  userId: string,
  userAgent?: string,
): Promise<Pick<DemoPersona, "id" | "role"> & { executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null }> {
  if (!env().DEMO_MODE) return fail.forbidden(ru.identity.demo.disabled);
  const persona = await db.user.findFirst({
    where: { id: userId, isDemo: true, blockedAt: null },
    select: { id: true, role: true, executorProfile: { select: { status: true } } },
  });
  if (!persona) return fail.notFound();
  await startSession(persona.id, userAgent);
  return { id: persona.id, role: persona.role, executor: persona.executorProfile };
}
