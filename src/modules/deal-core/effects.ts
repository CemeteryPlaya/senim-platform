import { ru } from "@/i18n/ru";
import { SYSTEM, type Actor } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import { requestOperation, type OperationRequest } from "@/modules/payments";
import type { Tx } from "@/platform/db";
import { enqueueJob } from "@/platform/jobs";
import { createStageAct, recalculateRating } from "./ports";
import { canMoveStage, moveDeal, moveStage, previousDone, type DealState, type StageState } from "./state";

/**
 * Последствия переходов — общие для действий сторон, решений оператора, автоприёмки и вебхуков банка.
 * Всё в той же транзакции, что и сам переход.
 */

export const SYSTEM_ACTOR: Actor = SYSTEM("deal-core");
export const JOB_SETTLE = "deal-core.settlePayment";
export const JOB_AUTO_ACCEPT = "deal-core.autoAcceptStage";
export const JOB_OPEN_ACCOUNT = "deal-core.openEscrowAccount";

const t = ru.deal.notify;
const link = (dealId: string) => `/deals/${dealId}`;

/** Executor — профиль; уведомление идёт пользователю профиля. */
async function executorUserId(tx: Tx, deal: DealState): Promise<string> {
  const profile = await tx.executorProfile.findUniqueOrThrow({ where: { id: deal.executorId }, select: { userId: true } });
  return profile.userId;
}

export async function notifyParty(
  tx: Tx,
  deal: DealState,
  to: "CLIENT" | "EXECUTOR",
  kind: string,
  msg: { title: string; body: string },
) {
  const userId = to === "CLIENT" ? deal.clientId : await executorUserId(tx, deal);
  await notify(tx, { userId, kind, title: msg.title, body: msg.body, link: link(deal.id) });
}

/** Денежная операция по счёту (только эскроу-режимы): запись в журнал + задача на отправку в банк. */
export async function requestMoney(tx: Tx, input: OperationRequest) {
  const created = await requestOperation(tx, input);
  if (created) {
    await enqueueJob(tx, { kind: JOB_SETTLE, payload: { idempotencyKey: input.idempotencyKey }, dedupeKey: `settle:${input.idempotencyKey}` });
  }
}

/**
 * Оплата этапа стала к оплате (ADR-002): manual — просим заказчика оплатить исполнителю,
 * эскроу — запрашиваем раскрытие транша с ключом release:<stageId>. Один этап — один транш,
 * сколько бы раз и каким путём (приёмка, автоприёмка, спор) сюда ни пришли.
 */
export async function paymentBecameDue(tx: Tx, deal: DealState, stage: StageState) {
  if (!stage.payment || stage.payment.status !== "DUE") return;
  if (deal.paymentMode === "MANUAL") {
    await notifyParty(tx, deal, "CLIENT", "deal.payment.due", { title: t.paymentDue.title, body: t.paymentDue.body(stage.title) });
    return;
  }
  await requestMoney(tx, { dealId: deal.id, stageId: stage.id, kind: "RELEASE", amount: stage.payment.amount, idempotencyKey: `release:${stage.id}` });
}

/** Сделка перешла в работу: аванс первого этапа (если есть) становится к оплате. */
export async function afterDealStarted(tx: Tx, deal: DealState) {
  const first = deal.stages[0];
  if (first?.paymentDue === "ON_START") await paymentBecameDue(tx, deal, first);
  await notifyParty(tx, deal, "EXECUTOR", "deal.started", { title: t.started.title, body: t.started.body(deal.number) });
  await notifyParty(tx, deal, "CLIENT", "deal.started", { title: t.started.title, body: t.started.body(deal.number) });
}

/** Этап принят (заказчиком, автоприёмкой или решением спора): акт, оплата этого этапа и аванс следующего. */
export async function afterStageAccepted(tx: Tx, deal: DealState, stage: StageState) {
  await createStageAct(tx, stage.id);
  stage.documents = await tx.document.findMany({ where: { stageId: stage.id, kind: "STAGE_ACT" }, select: { id: true, status: true } });
  for (const to of ["CLIENT", "EXECUTOR"] as const) {
    await notifyParty(tx, deal, to, "deal.act.ready", { title: t.actReady.title, body: t.actReady.body(stage.title) });
  }
  if (stage.paymentDue === "ON_ACCEPTANCE") await paymentBecameDue(tx, deal, stage);
  const next = deal.stages.find((s) => s.order === stage.order + 1);
  if (next && next.paymentDue === "ON_START" && previousDone(deal, next)) await paymentBecameDue(tx, deal, next);
}

/** Закрыть этап, если акт подписан и оплата подтверждена (или суммы нет); затем — завершить сделку. */
export async function tryCloseStage(tx: Tx, deal: DealState, stage: StageState) {
  if (!canMoveStage(deal, stage, "close", "SYSTEM")) return;
  await moveStage(tx, deal, stage, { event: "close", who: "SYSTEM", actor: SYSTEM_ACTOR, audit: { action: "deal.stage.closed" }, data: { closedAt: new Date() } });
  await tryCompleteDeal(tx, deal);
}

export async function tryCompleteDeal(tx: Tx, deal: DealState) {
  if (deal.status !== "IN_PROGRESS" || !deal.stages.every((s) => s.status === "CLOSED")) return;
  const now = new Date();
  await moveDeal(tx, deal, { event: "complete", who: "SYSTEM", actor: SYSTEM_ACTOR, audit: { action: "deal.completed" }, data: { completedAt: now, closedAt: now } });
  await recalculateRating(tx, deal.executorId);
  for (const to of ["CLIENT", "EXECUTOR"] as const) {
    await notifyParty(tx, deal, to, "deal.completed", { title: t.completed.title, body: t.completed.body(deal.number) });
  }
}
