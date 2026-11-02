import type { DisputeOutcome } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { isUniqueViolation, transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import type { ResolveDispute } from "./contracts";
import { notifyBoth, notifyOperators, notifyParty, otherParty, partyText } from "./effects";
import { freezePayout, processDealMoney, requestPayout, requestRefund, unfreezePayout } from "./money";
import { attachOwnFiles, requests } from "./ports";
import { disputePositionSchema, openDisputeSchema, resolveDisputeSchema } from "./schemas";
import { contextOf, lockDeal, refuse, requireRole, scopeOf, type DealState } from "./state";
import { DISPUTABLE } from "./transitions";

/**
 * Спор (ТЗ п. 9, ADR-009 раздел 3). Открывает любая сторона с PAID_HOLD по READY; один открытый на сделку
 * (частичный уникальный индекс). Пока открыт — все переходы сделки и выплата запрещены (таблица переходов),
 * в журнале — FREEZE. Решает оператор; итог оформляется операциями журнала, статус двигают их подтверждения.
 */

const t = ru.deal.notify;
const e = ru.deal.errors;

export async function openDispute(
  user: CurrentUser,
  raw: { dealId: string; reason: string; description: string; photoIds?: string[] },
): Promise<{ disputeId: string }> {
  const input = parseInput(openDisputeSchema, raw);
  try {
    return await transaction(async (tx) => {
      const deal = await lockDeal(tx, input.dealId);
      const who = requireRole(user, deal);
      if (who === "OPERATOR") return fail.forbidden(e.notYourAction);
      const ctx = contextOf(deal);
      if (ctx.openDispute) return fail.conflict(e.disputeExists);
      if (!DISPUTABLE.includes(deal.status)) return fail.conflict(e.disputeNotNow);
      if (ctx.money.exitRequested) return refuse("moneyLeaving");
      const dispute = await tx.dispute.create({
        data: {
          dealId: deal.id,
          openedInStatus: deal.status,
          openedById: user.id,
          reason: input.reason,
          description: await partyText(tx, deal, who, input.description),
        },
        select: { id: true },
      });
      await attachOwnFiles(tx, { fileIds: input.photoIds, uploadedById: user.id, owner: { disputeId: dispute.id } });
      await recordAudit(tx, {
        actor: actorOf(user),
        action: "dispute.opened",
        entity: { type: "dispute", id: dispute.id },
        scope: scopeOf(deal.id),
        after: { reason: input.reason, openedInStatus: deal.status },
      });
      await freezePayout(tx, deal, dispute.id, user.id);
      await notifyParty(tx, deal, otherParty(who), "dispute.opened", { title: t.disputeOpened.title, body: t.disputeOpened.body(deal.number) });
      await notifyOperators(tx, "dispute.opened", { title: t.disputeOpenedOperator.title, body: t.disputeOpenedOperator.body(deal.number) }, `/operator/disputes/${dispute.id}`);
      return { disputeId: dispute.id };
    });
  } catch (err) {
    // Параллельное открытие второго спора: частичный уникальный индекс «один открытый на сделку».
    if (isUniqueViolation(err)) return fail.conflict(e.disputeExists);
    throw err;
  }
}

async function lockDispute(tx: Tx, disputeId: string) {
  const ref = await tx.dispute.findUnique({ where: { id: disputeId }, select: { dealId: true } });
  if (!ref) return fail.notFound(e.disputeNotFound);
  const deal = await lockDeal(tx, ref.dealId);
  const dispute = await tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
  return { deal, dispute };
}

/** Позиция стороны по открытому спору (текст без контактов и имени мастера). */
export async function submitDisputePosition(user: CurrentUser, raw: { disputeId: string; position: string }): Promise<void> {
  const input = parseInput(disputePositionSchema, raw);
  await transaction(async (tx) => {
    const { deal, dispute } = await lockDispute(tx, input.disputeId);
    const who = requireRole(user, deal);
    if (who === "OPERATOR") return fail.forbidden(e.positionNotParty);
    if (dispute.status !== "OPEN") return fail.conflict(e.disputeResolved);
    const text = await partyText(tx, deal, who, input.position);
    const result = await tx.dispute.updateMany({ where: { id: dispute.id, status: "OPEN" }, data: who === "CLIENT" ? { clientPosition: text } : { executorPosition: text } });
    expectOneUpdated(result, e.disputeResolved);
    await recordAudit(tx, { actor: actorOf(user), action: "dispute.position.submitted", entity: { type: "dispute", id: dispute.id }, scope: scopeOf(deal.id) });
  });
}

/** Операции журнала по итогу спора; статус сделки двинут их подтверждения (onMoneySettled). */
async function applyOutcome(tx: Tx, deal: DealState, disputeId: string, outcome: DisputeOutcome, share: bigint | undefined, operatorId: string): Promise<void> {
  await unfreezePayout(tx, deal, disputeId, operatorId);
  if (outcome === "FULL_REFUND") {
    await requestRefund(tx, deal, deal.money.heldEntry?.amountTiyn ?? deal.buyerTotalTiyn, { disputeId, actorId: operatorId });
    // Полный возврат: работа не оплачена — заявка не исполнена, как при отмене.
    await requests().onDealCancelled(tx, deal.id);
  }
  if (outcome === "PARTIAL_SPLIT") await requestPayout(tx, deal, { basisDocumentId: null, disputeId, shareTiyn: share });
}

/**
 * Решение оператора (таблица ADR-009 раздел 3): во всех итогах — UNFREEZE;
 * CONTINUE — и только; FULL_REFUND — REFUND всего оплаченного (защита тоже возвращается, доход 0);
 * PARTIAL_SPLIT — RELEASE, SPLIT_MASTER = ⌊Y×0,96⌋, SPLIT_PLATFORM = ⌈Y×0,02⌉ + (Y − ⌊Y×0,96⌋), REFUND остатка.
 * Двойной клик — CONFLICT: спор закрывается условным обновлением «where status = OPEN».
 */
export const resolveDispute: ResolveDispute = async (operator, raw) => {
  if (operator.role !== "OPERATOR") return fail.forbidden();
  const input = parseInput(resolveDisputeSchema, raw);
  const dealId = await transaction(async (tx) => {
    const { deal, dispute } = await lockDispute(tx, input.disputeId);
    if (dispute.status !== "OPEN") return fail.conflict(e.disputeResolved);
    const share = input.masterShareTiyn;
    if (share !== undefined && (share <= 0n || share > deal.priceTiyn)) return fail.validation(e.shareRange, { fieldErrors: { masterShareTiyn: [e.shareRange] } });
    const result = await tx.dispute.updateMany({
      where: { id: dispute.id, status: "OPEN" },
      data: { status: "RESOLVED", outcome: input.outcome, masterShareTiyn: share ?? null, rationale: input.rationale, resolvedById: operator.id, resolvedAt: new Date() },
    });
    expectOneUpdated(result, e.disputeResolved);
    await recordAudit(tx, {
      actor: actorOf(operator),
      action: "dispute.resolved",
      entity: { type: "dispute", id: dispute.id },
      scope: scopeOf(deal.id),
      before: { status: "OPEN" },
      after: { status: "RESOLVED", outcome: input.outcome, masterShareTiyn: share?.toString() ?? null },
    });
    await applyOutcome(tx, deal, dispute.id, input.outcome, share, operator.id);
    await notifyBoth(tx, deal, "dispute.resolved", { title: t.disputeResolved.title, body: t.disputeResolved.body(deal.number) });
    return deal.id;
  });
  await processDealMoney(dealId);
};
