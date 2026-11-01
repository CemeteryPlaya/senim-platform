import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { attachFiles } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import {
  activeRailMode,
  ensureEscrowAccount,
  escrowAvailable,
  executeOperation,
  isFullyFunded,
  paymentModeOf,
  pendingOperationKeys,
  receiveWebhook,
  type RailMode,
  type SettledHook,
} from "@/modules/payments";
import { isUniqueViolation, transaction, type Tx } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { enqueueJob } from "@/platform/jobs";
import { logger } from "@/platform/logger";
import type { CancelDealHooks, CreateDeal, OnDocumentSigned } from "./contracts";
import {
  afterDealStarted,
  afterStageAccepted,
  DAY_MS,
  JOB_OPEN_ACCOUNT,
  notifyOperatorsPaymentFailed,
  notifyParty,
  partyText,
  requestMoney,
  scheduleAutoAccept,
  tryCloseStage,
} from "./effects";
import { createContract, recalculateRating, withdrawContract } from "./ports";
import {
  autoAcceptPayloadSchema,
  cancelDealSchema,
  createDealSchema,
  parseInput,
  reviewSchema,
  reworkSchema,
  stageRefSchema,
  submitStageSchema,
} from "./schemas";
import { planStages } from "./stage-plan";
import { lockDeal, lockStage, moveDeal, movePayment, moveStage, requireRole, scopeOf, type DealState, type StageState } from "./state";
import type { Who } from "./transitions";

const t = ru.deal.notify;

// ─── Создание и подпись договора ─────────────────────────────────────────────

/**
 * requests → deal-core: сделка в транзакции перехода заявки в CONTRACTING.
 * Режим оплаты фиксируется в сделке из активного режима (payments.activeRailMode).
 */
export const createDeal: CreateDeal = async (tx, raw) => {
  const input = parseInput(createDealSchema, raw);
  const offer = await tx.offer.findUnique({ where: { id: input.offerId }, include: { request: { select: { clientId: true } } } });
  if (!offer || offer.requestId !== input.requestId || offer.executorId !== input.executorId || offer.request.clientId !== input.clientId) {
    return fail.validation(ru.deal.errors.badDealInput);
  }
  const planned = planStages(input.template, input.totalAmount);
  const paymentMode = paymentModeOf(await activeRailMode());

  let dealId: string;
  try {
    const deal = await tx.deal.create({
      data: {
        requestId: input.requestId,
        offerId: input.offerId,
        clientId: input.clientId,
        executorId: input.executorId,
        title: input.title,
        totalAmount: input.totalAmount,
        paymentMode,
        stageTemplate: input.template.key,
        autoAcceptDays: env().AUTO_ACCEPT_DAYS,
        stages: {
          create: planned.map((s) => ({
            order: s.order,
            title: s.title,
            description: s.description,
            amount: s.amount,
            paymentDue: s.paymentDue,
            payment: s.amount > 0 ? { create: { amount: s.amount } } : undefined,
          })),
        },
      },
    });
    dealId = deal.id;
  } catch (e) {
    if (isUniqueViolation(e)) return fail.conflict(ru.deal.errors.dealExists);
    throw e;
  }

  await recordAudit(tx, {
    actor: { kind: "user", id: input.clientId, role: "CLIENT" },
    action: "deal.created",
    entity: { type: "deal", id: dealId },
    scope: scopeOf(dealId),
    after: { status: "AWAITING_SIGNATURES", totalAmount: input.totalAmount, stageTemplate: input.template.key, paymentMode },
    meta: { requestId: input.requestId, offerId: input.offerId },
  });
  await createContract(tx, dealId);
  const deal = await lockDeal(tx, dealId);
  for (const to of ["CLIENT", "EXECUTOR"] as const) {
    await notifyParty(tx, deal, to, "deal.contract.ready", { title: t.contractReady.title, body: t.contractReady.body(deal.number) });
  }
  return { dealId };
};

/**
 * documents → deal-core (хук onFullySigned): документ подписали обе стороны.
 * Договор: manual — сделка в работе; эскроу — ждём пополнения счёта. Акт: этап может закрыться.
 * Повторный вызов по уже обработанному документу ничего не меняет.
 */
export const onDocumentSigned: OnDocumentSigned = async (tx, documentId) => {
  const doc = await tx.document.findUnique({ where: { id: documentId }, select: { dealId: true, stageId: true, kind: true } });
  if (!doc) return fail.notFound(ru.deal.errors.notFound);
  const deal = await lockDeal(tx, doc.dealId);

  if (doc.kind === "STAGE_ACT") {
    const stage = deal.stages.find((s) => s.id === doc.stageId);
    if (!stage) return;
    stage.documents = stage.documents.map((d) => (d.id === documentId ? { ...d, status: "SIGNED" } : d));
    await tryCloseStage(tx, deal, stage);
    return;
  }

  if (deal.status !== "AWAITING_SIGNATURES") return;
  const to = await moveDeal(tx, deal, {
    event: "contractSigned",
    who: "SYSTEM",
    actor: SYSTEM("documents"),
    audit: { action: "deal.signed", meta: { documentId } },
    data: { signedAt: new Date() },
  });
  if (to === "IN_PROGRESS") {
    await afterDealStarted(tx, deal);
    return;
  }
  await enqueueJob(tx, { kind: JOB_OPEN_ACCOUNT, payload: { dealId: deal.id }, dedupeKey: `open-account:${deal.id}` });
  await notifyParty(tx, deal, "CLIENT", "deal.deposit.due", { title: t.awaitingDeposit.title, body: t.awaitingDeposit.body(deal.number) });
};

// ─── Деньги: хук payments и отправка операций в банк ─────────────────────────

/** payments → deal-core: операция по счёту выполнена или отклонена (в транзакции payments, сделка уже заблокирована). */
export const onPaymentSettled: SettledHook = async (tx, op) => {
  const deal = await lockDeal(tx, op.dealId);
  if (op.status === "FAILED") {
    await notifyOperatorsPaymentFailed(tx, deal, op);
    return;
  }

  if (op.kind === "DEPOSIT") {
    if (deal.status === "AWAITING_DEPOSIT" && (await isFullyFunded(tx, deal.id, deal.totalAmount))) {
      await moveDeal(tx, deal, {
        event: "depositReceived",
        who: "SYSTEM",
        actor: SYSTEM("payments"),
        audit: { action: "deal.started", meta: { operation: op.idempotencyKey } },
        ctx: { fullyFunded: true },
      });
      await afterDealStarted(tx, deal);
    } else if (deal.status === "CANCELLED" || deal.status === "TERMINATED") {
      // Деньги пришли после отмены — возвращаем заказчику.
      await requestMoney(tx, { dealId: deal.id, kind: "REFUND", amount: op.amount, idempotencyKey: `${op.idempotencyKey}:refund` });
    }
    return;
  }

  if (op.kind === "RELEASE" && op.stageId) {
    const stage = deal.stages.find((s) => s.id === op.stageId);
    if (!stage?.payment || stage.payment.status !== "DUE") return;
    await movePayment(tx, deal, stage, {
      event: "release",
      who: "SYSTEM",
      actor: SYSTEM("payments"),
      audit: { action: "deal.stage.payment.released", meta: { operation: op.idempotencyKey } },
      data: { confirmedAt: new Date() },
    });
    await notifyParty(tx, deal, "EXECUTOR", "deal.payment.released", { title: t.paymentReleased.title, body: t.paymentReleased.body(stage.title) });
    await tryCloseStage(tx, deal, stage);
  }
};

/**
 * Отправить в банк операции сделки, записанные в журнал. Вызывается после фиксации транзакции;
 * сбой банка не ломает действие пользователя — задачу deal-core.settlePayment повторит планировщик.
 */
export async function settleDeal(dealId: string): Promise<void> {
  for (const key of await pendingOperationKeys(dealId)) {
    try {
      await executeOperation(key, onPaymentSettled);
    } catch (error) {
      logger.warn("payment operation postponed", { dealId, operation: key, error });
    }
  }
}

/** Вебхук рельса (маршрут /api/webhooks/* и банк-симулятор): проверка, запись, обработка, отправка новых операций. */
export async function handleRailWebhook(mode: RailMode, input: { headers: Headers; rawBody: string }) {
  const outcome = await receiveWebhook(mode, input, onPaymentSettled);
  if (outcome.dealId) await settleDeal(outcome.dealId);
  return outcome;
}

/** Открыть счёт сделки у рельса (задача и «ленивое» открытие при показе сделки). */
export async function openEscrowAccount(dealId: string) {
  return ensureEscrowAccount(dealId);
}

// ─── Этапы ───────────────────────────────────────────────────────────────────

/** Шаг стороны над этапом: блокировка сделки, роль пользователя в ней (чужая сделка — «не найдено»), затем шаг. */
function asStageParty<R>(user: CurrentUser, stageId: string, step: (tx: Tx, s: { deal: DealState; stage: StageState; who: Who }) => Promise<R>): Promise<R> {
  return transaction(async (tx) => {
    const { deal, stage } = await lockStage(tx, stageId);
    return step(tx, { deal, stage, who: requireRole(user, deal) });
  });
}

export async function startStage(user: CurrentUser, raw: { stageId: string }) {
  const input = parseInput(stageRefSchema, raw);
  await asStageParty(user, input.stageId, async (tx, { deal, stage, who }) => {
    await moveStage(tx, deal, stage, { event: "start", who, actor: actorOf(user), audit: { action: "deal.stage.started" }, data: { startedAt: new Date() } });
    await notifyParty(tx, deal, "CLIENT", "deal.stage.started", { title: t.stageStarted.title, body: t.stageStarted.body(stage.title) });
  });
}

/** Исполнитель сдаёт этап с отчётом и фото (id StoredFile, загруженные им же). Ставится автоприёмка. */
export async function submitStage(user: CurrentUser, raw: { stageId: string; report: string; photoIds: string[] }) {
  const input = parseInput(submitStageSchema, raw);
  await asStageParty(user, input.stageId, async (tx, { deal, stage, who }) => {
    const submittedAt = new Date();
    const autoAcceptAt = new Date(submittedAt.getTime() + deal.autoAcceptDays * DAY_MS);
    await moveStage(tx, deal, stage, {
      event: "submit",
      who,
      actor: actorOf(user),
      audit: { action: "deal.stage.submitted", meta: { photos: input.photoIds.length } },
      data: { report: await partyText(tx, deal, who, input.report), submittedAt, autoAcceptAt },
    });
    await attachStagePhotos(tx, user, stage.id, input.photoIds);
    await scheduleAutoAccept(tx, { id: stage.id, submittedAt }, autoAcceptAt);
    await notifyParty(tx, deal, "CLIENT", "deal.stage.submitted", { title: t.stageSubmitted.title, body: t.stageSubmitted.body(stage.title) });
  });
}

/**
 * Фото этапа прикрепляет модуль files (только свои, STAGE_REPORT, ещё не прикреплённые).
 * При повторной сдаче фото, уже прикреплённые к этому этапу, можно оставить.
 */
async function attachStagePhotos(tx: Tx, user: CurrentUser, stageId: string, ids: string[]) {
  const attached = new Set((await tx.storedFile.findMany({ where: { stageId }, select: { id: true } })).map((f) => f.id));
  const fresh = [...new Set(ids)].filter((id) => !attached.has(id));
  if (fresh.length > 0) await attachFiles(tx, { fileIds: fresh, uploadedById: user.id, owner: { stageId } });
}

export async function requestRework(user: CurrentUser, raw: { stageId: string; note: string }) {
  const input = parseInput(reworkSchema, raw);
  await asStageParty(user, input.stageId, async (tx, { deal, stage, who }) => {
    // Замечание видит исполнитель — без контактов, как остальные тексты сторон.
    const note = await partyText(tx, deal, who, input.note);
    await moveStage(tx, deal, stage, {
      event: "requestRework",
      who,
      actor: actorOf(user),
      audit: { action: "deal.stage.rework", meta: { note } },
      data: { reworkNote: note, autoAcceptAt: null },
    });
    await notifyParty(tx, deal, "EXECUTOR", "deal.stage.rework", { title: t.stageRework.title, body: t.stageRework.body(stage.title) });
  });
}

/** Заказчик принимает этап. Двойной клик: второй вызов ждёт блокировку сделки и получает CONFLICT — второго транша нет. */
export async function acceptStage(user: CurrentUser, raw: { stageId: string }) {
  const input = parseInput(stageRefSchema, raw);
  const dealId = await asStageParty(user, input.stageId, async (tx, { deal, stage, who }) => {
    await moveStage(tx, deal, stage, {
      event: "accept",
      who,
      actor: actorOf(user),
      audit: { action: "deal.stage.accepted" },
      data: { acceptedAt: new Date(), acceptedBy: user.id, autoAcceptAt: null },
    });
    await afterStageAccepted(tx, deal, stage);
    await notifyParty(tx, deal, "EXECUTOR", "deal.stage.accepted", { title: t.stageAccepted.title, body: t.stageAccepted.body(stage.title) });
    return deal.id;
  });
  await settleDeal(dealId);
}

/**
 * Задача deal-core.autoAcceptStage: этап принимается сам, если заказчик молчит.
 * Идемпотентна: этап уже не SUBMITTED, сдан заново (другое время сдачи), идёт спор или срок не вышел —
 * ничего не делает. Задача, поставленная заново после решения спора (resumedAt), — та же сдача с новым сроком.
 * Повторный запуск после сбоя посередине транзакции ничего не дублирует.
 */
export async function autoAcceptStage(payload: unknown, now = new Date()): Promise<"accepted" | "skipped"> {
  const { stageId, submittedAt } = parseInput(autoAcceptPayloadSchema, payload);
  const result = await transaction(async (tx) => {
    const ref = await tx.stage.findUnique({ where: { id: stageId }, select: { dealId: true } });
    if (!ref) return null;
    const { deal, stage } = await lockStage(tx, stageId);
    const sameSubmission = stage.submittedAt?.toISOString() === submittedAt;
    const due = !!stage.autoAcceptAt && stage.autoAcceptAt <= now;
    if (stage.status !== "SUBMITTED" || !sameSubmission || !due || deal.status !== "IN_PROGRESS") return null;
    await moveStage(tx, deal, stage, {
      event: "autoAccept",
      who: "SYSTEM",
      actor: SYSTEM("auto-accept"),
      audit: { action: "deal.stage.auto_accepted" },
      data: { acceptedAt: now, acceptedBy: "system:auto-accept", autoAcceptAt: null },
      now,
    });
    await afterStageAccepted(tx, deal, stage);
    for (const to of ["CLIENT", "EXECUTOR"] as const) {
      await notifyParty(tx, deal, to, "deal.stage.auto_accepted", { title: t.stageAutoAccepted.title, body: t.stageAutoAccepted.body(stage.title) });
    }
    return deal.id;
  });
  if (!result) return "skipped";
  await settleDeal(result);
  return "accepted";
}

// ─── Оплата этапа (manual) ───────────────────────────────────────────────────

export async function markStagePaid(user: CurrentUser, raw: { stageId: string }) {
  const input = parseInput(stageRefSchema, raw);
  await asStageParty(user, input.stageId, async (tx, { deal, stage, who }) => {
    await movePayment(tx, deal, stage, { event: "markPaid", who, actor: actorOf(user), audit: { action: "deal.stage.payment.marked" }, data: { markedPaidAt: new Date() } });
    await notifyParty(tx, deal, "EXECUTOR", "deal.payment.marked", { title: t.paymentMarked.title, body: t.paymentMarked.body(stage.title) });
  });
}

export async function confirmStagePayment(user: CurrentUser, raw: { stageId: string }) {
  const input = parseInput(stageRefSchema, raw);
  await asStageParty(user, input.stageId, async (tx, { deal, stage, who }) => {
    await movePayment(tx, deal, stage, { event: "confirm", who, actor: actorOf(user), audit: { action: "deal.stage.payment.confirmed" }, data: { confirmedAt: new Date() } });
    await notifyParty(tx, deal, "CLIENT", "deal.payment.confirmed", { title: t.paymentConfirmed.title, body: t.paymentConfirmed.body(stage.title) });
    await tryCloseStage(tx, deal, stage);
  });
}

// ─── Отмена и отзыв ──────────────────────────────────────────────────────────

/**
 * Отмена до начала работ. Неподписанный договор снимается с подписи (documents.withdrawContract),
 * в эскроу внесённое возвращается заказчику (ключ cancel:<dealId>:refund), заявка закрывается хуком
 * hooks.onCancelled (requests.onDealCancelled) — всё в одной транзакции.
 */
export async function cancelDeal(user: CurrentUser, raw: { dealId: string; reason?: string }, hooks: CancelDealHooks) {
  const input = parseInput(cancelDealSchema, raw);
  await transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    const who = requireRole(user, deal);
    await moveDeal(tx, deal, { event: "cancel", who, actor: actorOf(user), audit: { action: "deal.cancelled", meta: { reason: input.reason } }, data: { closedAt: new Date() } });
    await withdrawContract(tx, deal.id);
    await hooks.onCancelled(tx, deal.id);
    const balance = deal.paymentMode === "MANUAL" ? 0 : await escrowAvailable(tx, deal.id);
    if (balance > 0) await requestMoney(tx, { dealId: deal.id, kind: "REFUND", amount: balance, idempotencyKey: `cancel:${deal.id}:refund` });
    await notifyParty(tx, deal, who === "CLIENT" ? "EXECUTOR" : "CLIENT", "deal.cancelled", { title: t.cancelled.title, body: t.cancelled.body(deal.number) });
  });
  await settleDeal(input.dealId);
}

/** Отзыв: только заказчик, только по завершённой сделке, один на сделку. Рейтинг пересчитывает companies. */
export async function leaveReview(user: CurrentUser, raw: { dealId: string; rating: number; text?: string }) {
  const input = parseInput(reviewSchema, raw);
  await transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    const who = requireRole(user, deal);
    if (who !== "CLIENT") return fail.forbidden(ru.deal.errors.onlyClientReviews);
    if (deal.status !== "COMPLETED") return fail.conflict(ru.deal.errors.reviewOnlyCompleted);
    const created = await tx.review.createMany({
      data: [{ dealId: deal.id, executorId: deal.executorId, authorId: user.id, rating: input.rating, text: input.text }],
      skipDuplicates: true,
    });
    if (created.count === 0) return fail.conflict(ru.deal.errors.reviewExists);
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "review.created",
      entity: { type: "deal", id: deal.id },
      scope: scopeOf(deal.id),
      after: { rating: input.rating },
    });
    await recalculateRating(tx, deal.executorId);
    await notifyParty(tx, deal, "EXECUTOR", "deal.review", { title: t.review.title, body: t.review.body(input.rating) });
  });
}

