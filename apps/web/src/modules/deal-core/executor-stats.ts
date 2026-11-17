import "server-only";
import { db } from "@/platform/db";
import { ENDED_DEAL } from "./ended";

/** Числа мастера для профиля: сделки с офертой, оконченные, успешные и доля успешных среди оконченных. */
export type ExecutorStats = { deals: number; ended: number; successful: number; successRate: number | null };

/**
 * Один запрос на всех мастеров. Считаются только сделки с заключённой офертой (`signedAt`);
 * успешная — SPLIT_PAYOUT, оконченные — `ENDED_DEAL`. У мастера без сделок — запись с нулями и `successRate: null`.
 */
export async function executorStats(executorIds: readonly string[]): Promise<Map<string, ExecutorStats>> {
  const result = new Map<string, ExecutorStats>();
  if (executorIds.length === 0) return result;
  for (const id of executorIds) result.set(id, { deals: 0, ended: 0, successful: 0, successRate: null });

  const groups = await db.deal.groupBy({
    by: ["executorId", "status"],
    where: { executorId: { in: [...new Set(executorIds)] }, signedAt: { not: null } },
    _count: { _all: true },
  });
  for (const g of groups) {
    const stats = result.get(g.executorId);
    if (!stats) continue;
    const n = g._count._all;
    stats.deals += n;
    if (ENDED_DEAL.includes(g.status)) stats.ended += n;
    if (g.status === "SPLIT_PAYOUT") stats.successful += n;
  }
  for (const stats of result.values()) stats.successRate = stats.ended ? Math.round((stats.successful / stats.ended) * 100) : null;
  return result;
}
