import "server-only";
import { getPublicExecutorPage } from "@/modules/companies";
import { executorStats, listExecutorDealHistory } from "@/modules/deal-core";
import type { ExecutorPageData } from "./executor-view";

/**
 * Данные страницы мастера. companies не знает про сделки (deal-core зависит от companies, обратный импорт дал бы цикл),
 * поэтому числа сделок и «Сделки на площадке» страница берёт из deal-core сама. null — мастера нет или он не подтверждён.
 */
export async function loadExecutorPageData(publicNumber: number): Promise<ExecutorPageData | null> {
  const page = await getPublicExecutorPage(publicNumber);
  if (!page) return null;
  const [stats, dealHistory] = await Promise.all([executorStats([page.view.id]), listExecutorDealHistory(page.view.id)]);
  return { ...page, stats: stats.get(page.view.id) ?? { deals: 0, ended: 0, successful: 0, successRate: null }, dealHistory };
}
