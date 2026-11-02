import "server-only";
import { recordAudit, SYSTEM } from "@/modules/audit";
import type { RequestsPort } from "@/modules/deal-core";
import type { Tx } from "@/platform/db";
import { expectOneUpdated } from "@/platform/errors";
import { requestScope } from "./access";
import { onContractSigned } from "./measurements";
import { REQUEST_TRANSITIONS, transition } from "./transitions";

/**
 * Порт requests для deal-core (регистрирует src/ports.ts): судьба сделки двигает её заявку в той же транзакции.
 * Оба хука идемпотентны: повтор и заявка не в ожидаемом статусе ничего не меняют.
 */

const requestOfDeal = (tx: Tx, dealId: string) =>
  tx.deal.findUnique({ where: { id: dealId }, select: { requestId: true, request: { select: { status: true } } } });

/** Оферта заключена (deal-core.onContractSigned): заявка CONTRACTING → CLOSED. */
export async function onDealSigned(tx: Tx, dealId: string): Promise<void> {
  const deal = await requestOfDeal(tx, dealId);
  if (deal?.request.status !== "CONTRACTING") return;
  await onContractSigned(tx, deal.requestId);
}

/**
 * Сделка закончилась без выплаты мастеру (deal-core: отмена до оплаты, отмена после оплаты с возвратом,
 * полный возврат по спору): заявка CONTRACTING → CANCELLED (оферта не подписана) или CLOSED → CANCELLED
 * (оферта подписана). Раздел по спору (SPLIT_PAYOUT) заявку не трогает — работа оплачена, заявка исполнена.
 */
export async function onDealCancelled(tx: Tx, dealId: string): Promise<void> {
  const deal = await requestOfDeal(tx, dealId);
  if (!deal || (deal.request.status !== "CONTRACTING" && deal.request.status !== "CLOSED")) return;
  const from = deal.request.status;
  const to = transition(REQUEST_TRANSITIONS, "dealCancelled", from, "SYSTEM");
  expectOneUpdated(await tx.request.updateMany({ where: { id: deal.requestId, status: from }, data: { status: to, closedAt: new Date() } }));
  await recordAudit(tx, {
    actor: SYSTEM("requests"),
    action: "request.cancelled_with_deal",
    entity: { type: "request", id: deal.requestId },
    scope: requestScope(deal.requestId),
    before: { status: from },
    after: { status: to },
    meta: { dealId },
  });
}

export const requestsPort: RequestsPort = { onContractSigned: onDealSigned, onDealCancelled };
