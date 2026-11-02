import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { db, Prisma, type Db } from "@/platform/db";
import { NO_ORIGIN, requestOrigin, type Origin } from "./origin";

export { clientIpFrom, NO_ORIGIN, originFrom, requestOrigin, type Origin } from "./origin";

/**
 * Неизменяемый журнал событий, общий для всех модулей.
 * Только добавление: сервис не умеет update/delete, а БД запрещает их триггером.
 * Запись делается в той же транзакции, что и изменение состояния.
 */

export type Actor =
  | { kind: "user"; id: string; role: Role }
  | { kind: "system"; name: string };

export type AuditInput = {
  actor: Actor;
  /** Глагол в прошедшем времени через точку: «deal.stage.accepted». */
  action: string;
  entity: { type: string; id: string };
  /** Корень истории, например «deal:<id>»: по нему строится полная история сделки. */
  scope?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  meta?: Prisma.InputJsonValue;
  /**
   * Откуда (ТЗ п. 11). Не задан — для действия человека берётся из заголовков текущего запроса
   * (requestOrigin: IP с учётом TRUST_PROXY и User-Agent), вызывающему передавать ничего не нужно;
   * для системы — null. Задан явно — как есть (например, запрос пришёл не через Next).
   */
  origin?: Origin;
};

export const SYSTEM = (name: string): Actor => ({ kind: "system", name });

export async function recordAudit(tx: Db, input: AuditInput): Promise<void> {
  const { actor } = input;
  const origin = input.origin ?? (actor.kind === "user" ? await requestOrigin() : NO_ORIGIN);
  await tx.auditEvent.create({
    data: {
      actorId: actor.kind === "user" ? actor.id : null,
      actorRole: actor.kind === "user" ? actor.role : "SYSTEM",
      action: input.action,
      entityType: input.entity.type,
      entityId: input.entity.id,
      scope: input.scope,
      before: input.before,
      after: input.after,
      meta: actor.kind === "system" ? { system: actor.name, ...(asObject(input.meta) ?? {}) } : input.meta,
      ip: origin.ip,
      userAgent: origin.userAgent,
    },
  });
}

function asObject(v: Prisma.InputJsonValue | undefined): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export type AuditFilter = {
  entityType?: string;
  entityId?: string;
  scope?: string;
  actorId?: string;
  actionPrefix?: string;
  from?: Date;
  to?: Date;
  /** Курсор: вернуть события с seq меньше этого. */
  beforeSeq?: bigint;
  limit?: number;
};

export async function listAuditEvents(filter: AuditFilter = {}) {
  return db.auditEvent.findMany({
    where: {
      entityType: filter.entityType,
      entityId: filter.entityId,
      scope: filter.scope,
      actorId: filter.actorId,
      action: filter.actionPrefix ? { startsWith: filter.actionPrefix } : undefined,
      createdAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
      seq: filter.beforeSeq ? { lt: filter.beforeSeq } : undefined,
    },
    orderBy: { seq: "desc" },
    take: Math.min(filter.limit ?? 50, 200),
  });
}

/** Вся история корня (например, сделки со всеми этапами и платежами) по порядку — для показа банку. */
export async function scopeHistory(scope: string) {
  return db.auditEvent.findMany({ where: { scope }, orderBy: { seq: "asc" } });
}
