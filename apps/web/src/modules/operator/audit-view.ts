import type { AuditEvent } from "@/generated/prisma/client";

/** Запись журнала для экрана: seq — строка (BigInt не сериализуется в клиентские компоненты). */
export type AuditView = {
  seq: string;
  createdAt: Date;
  actorId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  scope: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  /** Откуда (ТЗ п. 11): IP с учётом TRUST_PROXY и устройство (User-Agent); у системных событий — нет. */
  ip: string | null;
  userAgent: string | null;
};

export function toAuditView(e: AuditEvent): AuditView {
  return {
    seq: e.seq.toString(),
    createdAt: e.createdAt,
    actorId: e.actorId,
    actorRole: e.actorRole,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    scope: e.scope,
    before: e.before,
    after: e.after,
    meta: e.meta,
    ip: e.ip,
    userAgent: e.userAgent,
  };
}
