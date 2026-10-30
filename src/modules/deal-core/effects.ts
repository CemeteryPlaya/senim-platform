import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM, type Actor } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import { requestOperation, type OperationRequest } from "@/modules/payments";
import type { Tx } from "@/platform/db";
import { enqueueJob } from "@/platform/jobs";
import { formatMoney } from "@/ui/format";
import { createStageAct, maskContacts, recalculateRating, sanitizeExecutorText } from "./ports";
import { canMoveStage, moveDeal, moveStage, previousDone, type DealState, type StageState } from "./state";
import type { Who } from "./transitions";

/**
 * Последствия переходов — общие для действий сторон, решений оператора, автоприёмки и вебхуков банка.
 * Всё в той же транзакции, что и сам переход.
 */

export const SYSTEM_ACTOR: Actor = SYSTEM("deal-core");
export const JOB_SETTLE = "deal-core.settlePayment";
export const JOB_AUTO_ACCEPT = "deal-core.autoAcceptStage";
export const JOB_OPEN_ACCOUNT = "deal-core.openEscrowAccount";

const t = ru.deal.notify;
export const DAY_MS = 24 * 3600 * 1000;
const link = (dealId: string) => `/deals/${dealId}`;

/** Executor — профиль; уведомление идёт пользователю профиля. */
async function executorUserId(tx: Tx, deal: DealState): Promise<string> {
  const profile = await tx.executorProfile.findUniqueOrThrow({ where: { id: deal.executorId }, select: { userId: true } });
  return profile.userId;
}

/**
 * Текст стороны, который увидит другая сторона (отчёт этапа, спор): без контактов, а у исполнителя —
 * ещё и без наименования/ФИО. Правило то же, что в чате.
 */
export async function partyText(tx: Tx, deal: { executorId: string }, who: Who, text: string): Promise<string> {
  return who === "EXECUTOR" ? (await sanitizeExecutorText(tx, deal.executorId, text)).text : maskContacts(text).text;
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

/**
 * Задача автоприёмки сданного этапа на срок autoAcceptAt. Каждая постановка — своя задача: при сдаче
 * ключ — этап + время сдачи; после решения спора — ещё и время решения (время сдачи не меняется,
 * поэтому обработчик по-прежнему узнаёт «ту же сдачу»).
 */
export async function scheduleAutoAccept(tx: Tx, stage: { id: string; submittedAt: Date }, autoAcceptAt: Date, resumedAt?: Date) {
  const base = `auto-accept:${stage.id}:${stage.submittedAt.getTime()}`;
  await enqueueJob(tx, {
    kind: JOB_AUTO_ACCEPT,
    payload: { stageId: stage.id, submittedAt: stage.submittedAt.toISOString(), ...(resumedAt && { resumedAt: resumedAt.toISOString() }) },
    runAt: autoAcceptAt,
    dedupeKey: resumedAt ? `${base}:resumed:${resumedAt.getTime()}` : base,
  });
}

/** Спор приостанавливает автоприёмку всех сданных этапов: срок сброшен, экран его не показывает. */
export async function pauseAutoAccept(tx: Tx, deal: DealState) {
  await tx.stage.updateMany({ where: { dealId: deal.id, status: "SUBMITTED" }, data: { autoAcceptAt: null } });
  for (const s of deal.stages) if (s.status === "SUBMITTED") s.autoAcceptAt = null;
}

/** Спор решён, сделка продолжается: каждому сданному этапу — новый срок от момента решения и новая задача. */
export async function resumeAutoAccept(tx: Tx, deal: DealState, resumedAt: Date) {
  const autoAcceptAt = new Date(resumedAt.getTime() + deal.autoAcceptDays * DAY_MS);
  for (const s of deal.stages) {
    if (s.status !== "SUBMITTED" || !s.submittedAt) continue;
    await tx.stage.updateMany({ where: { id: s.id, status: "SUBMITTED" }, data: { autoAcceptAt } });
    s.autoAcceptAt = autoAcceptAt;
    await scheduleAutoAccept(tx, { id: s.id, submittedAt: s.submittedAt }, autoAcceptAt, resumedAt);
    await recordAudit(tx, {
      actor: SYSTEM_ACTOR,
      action: "deal.stage.auto_accept.resumed",
      entity: { type: "stage", id: s.id },
      scope: `deal:${deal.id}`,
      after: { autoAcceptAt: autoAcceptAt.toISOString() },
    });
  }
}

/**
 * Банк отклонил операцию: всем действующим операторам — in-app уведомление со ссылкой на сделку
 * (повторить можно с новым ключом — retryPaymentOperation). Запись в журнал делает payments
 * (payment.operation.failed) в той же транзакции.
 * INTEGRATOR: заменить на notifications.notifyOperators, когда появится шаблон «payment.failed».
 */
export async function notifyOperatorsPaymentFailed(tx: Tx, deal: DealState, op: { kind: string; amount: number }) {
  const operators = await tx.user.findMany({ where: { role: "OPERATOR", blockedAt: null }, select: { id: true } });
  const msg = { title: t.paymentFailed.title, body: t.paymentFailed.body(deal.number, formatMoney(op.amount)) };
  for (const { id } of operators) await notify(tx, { userId: id, kind: "payment.failed", ...msg, link: link(deal.id) });
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
