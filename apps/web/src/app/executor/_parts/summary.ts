import "server-only";
import { getExecutorFinance, listDeals, monthOf } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { listIncomingRequests, type IncomingListItem } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { formatTiyn, type StatTileItem } from "@/ui";
import { ACTIVE_DEAL } from "@/app/deals/_parts/labels";
import { monthName } from "../finance/_parts/months";

const t = ru.executor.stats;

export type ExecutorSummary = { incoming: IncomingListItem[]; fresh: IncomingListItem[]; tiles: StatTileItem[] };

/**
 * Сводка мастера (макет master-screens, экран 1): новые заявки — без его отклика, в работе — его идущие сделки,
 * заработок за текущий месяц (время Казахстана) — подтверждённые выплаты из журнала денег (deal-core.getExecutorFinance).
 * Заработок — только на десктопе.
 */
export async function executorSummary(user: CurrentUser): Promise<ExecutorSummary> {
  const [incoming, deals, finance] = await Promise.all([listIncomingRequests(user), listDeals(user), getExecutorFinance(user)]);
  const fresh = incoming.filter((r) => r.myOfferStatus === null);
  const inWork = deals.filter((d) => d.myRole === "EXECUTOR" && ACTIVE_DEAL.has(d.status)).length;
  const month = monthOf(new Date());
  const earned = finance.months.find((m) => m.month === month)?.receivedTiyn ?? 0n;
  return {
    incoming,
    fresh,
    tiles: [
      { label: t.fresh, value: String(fresh.length) },
      { label: t.inWork, value: String(inWork) },
      { label: t.earned(monthName(month)), value: formatTiyn(earned), desktopOnly: true },
    ],
  };
}
