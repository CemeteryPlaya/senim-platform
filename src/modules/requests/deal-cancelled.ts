import "server-only";
import { recordAudit, SYSTEM } from "@/modules/audit";
import type { OnDealCancelled } from "@/modules/deal-core";
import { expectOneUpdated } from "@/platform/errors";
import { requestScope } from "./access";
import { REQUEST_TRANSITIONS, transition } from "./transitions";

/**
 * Хук отмены сделки (deal-core.cancelDeal → hooks.onCancelled, в той же транзакции):
 * заявка, по которой готовилась оферта, CONTRACTING → CANCELLED; оферта уже подписана (заявка CLOSED),
 * а оплаты не было — CLOSED → CANCELLED. Хук зовётся только при отмене до оплаты (сделка CREATED → CANCELLED),
 * поэтому CLOSED здесь — всегда «оферта подписана, денег нет». Заявку в другом статусе и повторный вызов не трогает.
 */
export const onDealCancelled: OnDealCancelled = async (tx, dealId) => {
  const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { requestId: true, request: { select: { status: true } } } });
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
};
