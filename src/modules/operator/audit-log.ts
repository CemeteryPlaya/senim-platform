import { listAuditEvents } from "@/modules/audit";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { assertOperator } from "./access";
import { toAuditView, type AuditView } from "./audit-view";
import type { AuditFilterInput } from "./schemas";

const PAGE = 50;

/**
 * Журнал аудита с фильтрами, от новых к старым; следующая страница — события с seq меньше nextBefore.
 * Фильтр по номеру сделки — вся её история (scope deal:<id>); неизвестный номер — пустой список.
 */
export async function searchAudit(
  user: CurrentUser,
  filter: AuditFilterInput,
  pageSize = PAGE,
): Promise<{ events: AuditView[]; nextBefore: string | null }> {
  assertOperator(user);
  const scope = filter.deal === undefined ? filter.scope : await dealScope(filter.deal);
  if (scope === null) return { events: [], nextBefore: null };
  const found = await listAuditEvents({
    entityType: filter.entityType,
    entityId: filter.entityId,
    scope,
    actorId: filter.actorId,
    actionPrefix: filter.action,
    from: filter.from,
    to: filter.to,
    beforeSeq: filter.before,
    limit: pageSize + 1,
  });
  const events = found.slice(0, pageSize).map(toAuditView);
  return { events, nextBefore: found.length > pageSize ? events[events.length - 1].seq : null };
}

async function dealScope(number: number): Promise<string | null> {
  const deal = await db.deal.findUnique({ where: { number }, select: { id: true } });
  return deal ? `deal:${deal.id}` : null;
}
