import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { attachFiles } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { escrowBalance } from "@/modules/payments";
import { transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import type { ResolveDispute } from "./contracts";
import { afterStageAccepted, notifyParty, partyText, requestMoney } from "./effects";
import { disputePositionSchema, openDisputeSchema, parseInput, resolveDisputeSchema } from "./schemas";
import { settleDeal } from "./service";
import { canMoveStage, lockDeal, moveDeal, moveStage, requireRole, scopeOf, type DealState, type StageState } from "./state";

/**
 * Споры: открывает сторона, решает оператор. Всё хранится структурированно (причина, позиции,
 * вложения, решение, сумма, обоснование) — это будущие обучающие данные.
 */

const t = ru.deal.notify;

/**
 * Этап, о котором спор: там, где сейчас идёт работа. Следующий этап можно начать, пока предыдущий
 * принят, но не закрыт, поэтому «первый незакрытый» — не то. Порядок: последний сданный,
 * иначе последний в работе или на доработке, иначе первый незакрытый (спор об оплате или акте).
 */
function currentStage(deal: DealState): StageState | null {
  const latest = (statuses: StageState["status"][]) => deal.stages.findLast((s) => statuses.includes(s.status));
  return latest(["SUBMITTED"]) ?? latest(["IN_PROGRESS", "REWORK"]) ?? deal.stages.find((s) => s.status !== "CLOSED") ?? null;
}

export async function openDispute(
  user: CurrentUser,
  raw: { dealId: string; reason: string; description: string; attachmentIds?: string[] },
): Promise<{ disputeId: string }> {
  const input = parseInput(openDisputeSchema, raw);
  return transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    const who = requireRole(user, deal);
    await moveDeal(tx, deal, { event: "openDispute", who, actor: actorOf(user), audit: { action: "deal.dispute.opened", meta: { reason: input.reason } } });
    const stage = currentStage(deal);
    const description = await partyText(tx, deal, who, input.description);
    const dispute = await tx.dispute.create({
      data: {
        dealId: deal.id,
        stageId: stage?.id,
        openedById: user.id,
        reason: input.reason,
        description,
        clientPosition: who === "CLIENT" ? description : null,
        executorPosition: who === "EXECUTOR" ? description : null,
      },
    });
    // Спор приостанавливает автоприёмку: задача увидит, что сделка не в работе, а срок сброшен.
    if (stage?.status === "SUBMITTED") await tx.stage.update({ where: { id: stage.id }, data: { autoAcceptAt: null } });
    await attachDisputeFiles(tx, user, dispute.id, input.attachmentIds);
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "dispute.opened",
      entity: { type: "dispute", id: dispute.id },
      scope: scopeOf(deal.id),
      before: { deal: "IN_PROGRESS" },
      after: { deal: "DISPUTE", reason: input.reason },
      meta: { stageId: stage?.id ?? null },
    });
    await notifyParty(tx, deal, who === "CLIENT" ? "EXECUTOR" : "CLIENT", "deal.dispute.opened", {
      title: t.disputeOpened.title,
      body: t.disputeOpened.body(deal.number),
    });
    return { disputeId: dispute.id };
  });
}

/** Вложения спора прикрепляет модуль files: только свои, DISPUTE, ещё не прикреплённые. */
async function attachDisputeFiles(tx: Tx, user: CurrentUser, disputeId: string, ids: string[]) {
  if (ids.length > 0) await attachFiles(tx, { fileIds: [...new Set(ids)], uploadedById: user.id, owner: { disputeId } });
}

/** Сторона излагает (или уточняет) свою позицию, пока спор открыт. */
export async function submitDisputePosition(user: CurrentUser, raw: { disputeId: string; position: string }) {
  const input = parseInput(disputePositionSchema, raw);
  await transaction(async (tx) => {
    const ref = await tx.dispute.findUnique({ where: { id: input.disputeId }, select: { dealId: true } });
    if (!ref) return fail.notFound(ru.deal.errors.disputeNotFound);
    const deal = await lockDeal(tx, ref.dealId);
    const who = requireRole(user, deal);
    if (who !== "CLIENT" && who !== "EXECUTOR") return fail.forbidden(ru.deal.errors.positionNotParty);
    const position = await partyText(tx, deal, who, input.position);
    const updated = await tx.dispute.updateMany({
      where: { id: input.disputeId, status: "OPEN" },
      data: who === "CLIENT" ? { clientPosition: position } : { executorPosition: position },
    });
    expectOneUpdated(updated, ru.deal.errors.disputeResolved);
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "dispute.position.submitted",
      entity: { type: "dispute", id: input.disputeId },
      scope: scopeOf(deal.id),
    });
  });
}

/**
 * operator → deal-core: решение по спору (ADR-002).
 *  FAVOR_EXECUTOR — этап принят (акт, оплата этапа: manual — отметки сторон, эскроу — транш release:<stageId>);
 *  FAVOR_CLIENT — этап на доработку; сделка в обоих случаях продолжается;
 *  TERMINATE — сделка расторгнута, в эскроу остаток возвращается (dispute:<id>:refund);
 *  PARTIAL — расторгнута, исполнителю decisionAmount (dispute:<id>:release), остальное — заказчику.
 * В manual платформа деньги не двигает: решение — запись и смена состояний.
 * Двойной клик оператора: второй вызов не найдёт OPEN-спор и получит CONFLICT.
 */
export const resolveDispute: ResolveDispute = async (operator, raw) => {
  if (operator.role !== "OPERATOR") return fail.forbidden();
  const input = parseInput(resolveDisputeSchema, raw);
  if (input.decision !== "PARTIAL" && input.decisionAmount !== undefined) return fail.validation(ru.deal.errors.amountOnlyPartial);

  const dealId = await transaction(async (tx) => {
    const ref = await tx.dispute.findUnique({ where: { id: input.disputeId } });
    if (!ref) return fail.notFound(ru.deal.errors.disputeNotFound);
    const deal = await lockDeal(tx, ref.dealId);
    const actor = actorOf(operator);
    const unpaid = deal.stages.reduce((sum, s) => sum + (s.payment && s.payment.status !== "CONFIRMED" ? s.payment.amount : 0), 0);
    if (input.decision === "PARTIAL" && (!input.decisionAmount || input.decisionAmount > unpaid)) {
      return fail.validation(ru.deal.errors.partialAmount);
    }

    const stage = deal.stages.find((s) => s.id === ref.stageId) ?? null;
    const decision = input.decision;
    const continues = decision === "FAVOR_CLIENT" || decision === "FAVOR_EXECUTOR";
    const stageMove = stage && continues ? stageOutcome(deal, stage, decision) : "keep";
    if (stageMove === "refuse") return fail.conflict(ru.deal.errors.decisionNotApplicable(stage!.title));

    const resolved = await tx.dispute.updateMany({
      where: { id: ref.id, status: "OPEN" },
      data: {
        status: "RESOLVED",
        decision: input.decision,
        decisionAmount: input.decisionAmount ?? null,
        rationale: input.rationale,
        resolvedById: operator.id,
        resolvedAt: new Date(),
      },
    });
    expectOneUpdated(resolved, ru.deal.errors.disputeResolved);

    // Сначала этап (пока сделка ещё в споре — так в таблице), потом сделка, потом последствия приёмки.
    const accepted = stage && continues && stageMove === "move" ? await applyStageDecision(tx, deal, stage, decision, input.rationale, actor) : false;
    await moveDeal(tx, deal, {
      event: continues ? "resolveContinue" : "resolveTerminate",
      who: "OPERATOR",
      actor,
      audit: { action: continues ? "deal.dispute.continued" : "deal.terminated", meta: { disputeId: ref.id, decision: input.decision } },
      data: continues ? undefined : { closedAt: new Date() },
    });
    if (accepted && stage) await afterStageAccepted(tx, deal, stage);
    if (!continues && deal.paymentMode !== "MANUAL") await settleTermination(tx, deal, ref.id, input.decisionAmount ?? 0);

    await recordAudit(tx, {
      actor,
      action: "dispute.resolved",
      entity: { type: "dispute", id: ref.id },
      scope: scopeOf(deal.id),
      before: { status: "OPEN" },
      after: { status: "RESOLVED", decision: input.decision, decisionAmount: input.decisionAmount ?? null, deal: deal.status },
    });
    for (const to of ["CLIENT", "EXECUTOR"] as const) {
      await notifyParty(tx, deal, to, "deal.dispute.resolved", { title: t.disputeResolved.title, body: t.disputeResolved.body(deal.number) });
    }
    return deal.id;
  });
  await settleDeal(dealId);
};

type StageDecision = "FAVOR_CLIENT" | "FAVOR_EXECUTOR";
const decisionEvent = (decision: StageDecision) => (decision === "FAVOR_EXECUTOR" ? "disputeFavorExecutor" : "disputeFavorClient");

/**
 * Что решение делает с этапом спора: move — переход по таблице; keep — этап уже там, где нужно
 * (не начат, уже на доработке, а в пользу исполнителя — уже принят), меняется только сделка;
 * refuse — принятый этап нельзя вернуть на доработку: оператору — понятный отказ, а не молчаливое продолжение.
 */
function stageOutcome(deal: DealState, stage: StageState, decision: StageDecision): "move" | "keep" | "refuse" {
  if (canMoveStage(deal, stage, decisionEvent(decision), "OPERATOR")) return "move";
  const accepted = stage.status === "ACCEPTED" || stage.status === "CLOSED";
  return decision === "FAVOR_CLIENT" && accepted ? "refuse" : "keep";
}

/** Двигает этап по решению (stageOutcome = move); возвращает, принят ли он. */
async function applyStageDecision(
  tx: Tx,
  deal: DealState,
  stage: StageState,
  decision: StageDecision,
  rationale: string,
  actor: ReturnType<typeof actorOf>,
): Promise<boolean> {
  const event = decisionEvent(decision);
  if (decision === "FAVOR_EXECUTOR") {
    await moveStage(tx, deal, stage, {
      event,
      who: "OPERATOR",
      actor,
      audit: { action: "deal.stage.accepted", meta: { byDispute: true } },
      data: { acceptedAt: new Date(), acceptedBy: actor.kind === "user" ? actor.id : null, autoAcceptAt: null },
    });
    return true;
  } else {
    await moveStage(tx, deal, stage, {
      event,
      who: "OPERATOR",
      actor,
      audit: { action: "deal.stage.rework", meta: { byDispute: true } },
      data: { reworkNote: rationale, autoAcceptAt: null },
    });
    return false;
  }
}

/** Расторжение в эскроу: исполнителю — присуждённое, заказчику — весь остаток счёта. */
async function settleTermination(tx: Tx, deal: DealState, disputeId: string, toExecutor: number) {
  const balance = await escrowBalance(tx, deal.id);
  const release = Math.min(toExecutor, balance);
  if (release > 0) await requestMoney(tx, { dealId: deal.id, kind: "RELEASE", amount: release, idempotencyKey: `dispute:${disputeId}:release` });
  if (balance - release > 0) {
    await requestMoney(tx, { dealId: deal.id, kind: "REFUND", amount: balance - release, idempotencyKey: `dispute:${disputeId}:refund` });
  }
}
