import "server-only";
import type { DealStatus, RequestStatus } from "@/generated/prisma/enums";
import { executorDisplays } from "@/modules/companies";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { requestTitle, requireClient } from "./access";

/**
 * История заказов покупателя (профиль мастера → «о покупателе», экран «История»): счётчики и строки со статусом.
 * Заказ — заявка кроме черновика; сделка — с заключённой офертой (`signedAt`); успешная — SPLIT_PAYOUT.
 * Один выбор лёгких полей по всем заявкам, затем имена мастеров одним батчем (ADR-006, без N+1).
 */

export type BuyerHistoryState = "success" | "cancelled" | "failed" | "progress";

export type BuyerHistoryRow = {
  requestId: string;
  title: string;
  /** Имя мастера сделки по режиму ADR-006; без сделки — null. */
  executorLabel: string | null;
  priceTiyn: bigint | null;
  state: BuyerHistoryState;
  /** v1-путь: сделка или заявка (на экране его переводит v2Href). */
  href: string;
  at: Date;
};

export type BuyerHistory = {
  counts: { orders: number; deals: number; successful: number };
  rows: BuyerHistoryRow[];
};

export const BUYER_HISTORY_LIMIT = 100;

type DealFacts = { status: DealStatus; signedAt: Date | null };

/** Статус строки: сделка с офертой — по сделке; иначе отмена (сделки или заявки) или «в процессе». */
function stateOf(requestStatus: RequestStatus, deal: DealFacts | null): BuyerHistoryState {
  if (deal?.signedAt) {
    if (deal.status === "SPLIT_PAYOUT") return "success";
    if (deal.status === "CANCELLED") return "cancelled";
    if (deal.status === "REFUNDED") return "failed";
    return "progress";
  }
  if (deal?.status === "CANCELLED" || requestStatus === "CANCELLED") return "cancelled";
  return "progress";
}

export async function buyerHistory(user: CurrentUser): Promise<BuyerHistory> {
  requireClient(user);
  const requests = await db.request.findMany({
    where: { clientId: user.id, status: { not: "DRAFT" } },
    select: {
      id: true,
      status: true,
      publishedAt: true,
      createdAt: true,
      customType: true,
      furnitureType: { select: { name: true } },
      // Заявка ↔ сделка один к одному (Deal.requestId уникален): «самая поздняя» не требуется.
      deal: { select: { id: true, status: true, signedAt: true, priceTiyn: true, executorId: true } },
    },
  });

  const counts = {
    orders: requests.length,
    deals: requests.filter((r) => r.deal?.signedAt).length,
    successful: requests.filter((r) => r.deal?.status === "SPLIT_PAYOUT").length,
  };

  const shown = requests
    .map((r) => ({ r, at: r.publishedAt ?? r.createdAt }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, BUYER_HISTORY_LIMIT);
  const masters = await executorDisplays(
    db,
    shown.flatMap(({ r }) => (r.deal ? [r.deal.executorId] : [])),
  );

  const rows = shown.map(({ r, at }): BuyerHistoryRow => ({
    requestId: r.id,
    title: requestTitle(r),
    executorLabel: r.deal ? (masters.get(r.deal.executorId)?.label ?? null) : null,
    priceTiyn: r.deal?.priceTiyn ?? null,
    state: stateOf(r.status, r.deal),
    href: r.deal ? `/deals/${r.deal.id}` : `/requests/${r.id}`,
    at,
  }));
  return { counts, rows };
}
