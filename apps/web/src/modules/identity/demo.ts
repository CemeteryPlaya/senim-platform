import "server-only";
import { randomUUID } from "node:crypto";
import { Role as ProtoRole } from "@/gen/senim/identity/v1/identity_pb";
import type { LegalForm, Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { roleFromProto, roleToProto } from "./projection";
import { identity } from "./remote";
import { identityFailure } from "./remote-errors";
import { newSessionToken } from "./session-cookie";
import { beginSession, signOutPrevious } from "./session";

/**
 * Демо-персоны: вход одним нажатием, только при DEMO_MODE=true и только пользователем с isDemo.
 * В MVP switchUser ставил cookie с любым id — здесь режим и isDemo проверяет identity (StartDemoSession),
 * а токен сессии создаёт web: без доверия к данным клиента.
 */

export type DemoPersona = {
  id: string;
  /** Роль по умолчанию: в ней персона входит и по ней группируется на /demo. */
  role: Role;
  /** Выданные роли (ADR-004): у персоны с двумя ролями в шапке есть переключатель. */
  roles: Role[];
  fullName: string | null;
  phone: string;
  executor: { publicNumber: number; legalForm: LegalForm; legalName: string; status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

const ROLE_ORDER: Record<Role, number> = { OPERATOR: 0, MEASURER: 1, CLIENT: 2, EXECUTOR: 3 };

export async function listDemoPersonas(): Promise<DemoPersona[]> {
  if (!env().DEMO_MODE) return [];
  const users = await db.user.findMany({
    where: { isDemo: true, blockedAt: null },
    select: {
      id: true,
      role: true,
      roles: true,
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

/**
 * Вход персоной (asRole — в указанной выданной роли): сессию начинает identity (StartDemoSession), web даёт токен;
 * возвращает роль сессии и статус профиля исполнителя — чтобы выбрать экран после входа.
 */
export async function loginAsDemoPersona(
  userId: string,
  userAgent?: string,
  asRole?: Role,
): Promise<Pick<DemoPersona, "id" | "role"> & { executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null }> {
  if (!env().DEMO_MODE) return fail.forbidden(ru.identity.demo.disabled);
  await signOutPrevious();

  const token = newSessionToken();
  let res;
  try {
    res = await identity().startDemoSession({
      userId,
      asRole: asRole ? roleToProto(asRole) : ProtoRole.UNSPECIFIED,
      sessionToken: token,
      userAgent: (userAgent ?? "").slice(0, 300),
      idempotencyKey: randomUUID(),
    });
  } catch (e) {
    return identityFailure(e);
  }
  const { user, session } = await beginSession(token, res);

  const profile = await db.executorProfile.findUnique({ where: { userId: user.id }, select: { status: true } });
  return { id: user.id, role: roleFromProto(session.activeRole), executor: profile };
}
