import type { MoneyTransaction } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import {
  computeSplit,
  enqueueExecution,
  executeDealOperations,
  isTestProvider,
  moneyKey,
  recordOperation,
  type ProviderResult,
  type RecordInput,
  type SettledHook,
} from "@/modules/payments";
import type { Tx } from "@/platform/db";
import { logger } from "@/platform/logger";
import { formatTiyn } from "@/ui/format";
import { dealLink, notifyBoth, notifyOperators, SYSTEM_ACTOR } from "./effects";
import { canMove, lockDeal, moveDeal, type DealState } from "./state";

/**
 * Деньги сделки: запросы операций журнала (HOLD, раскрытие и его части, возврат, заморозка по спору)
 * и обработчик их итога. Операция записывается в транзакции действия и ставится на исполнение;
 * статус сделки двигает только подтверждённый итог (onMoneySettled). Ключи — payments.moneyKey.
 */

type Op = Omit<RecordInput, "dealId" | "provider" | "isTest">;

async function record(tx: Tx, deal: DealState, op: Op): Promise<MoneyTransaction> {
  const { entry, created } = await recordOperation(tx, { ...op, dealId: deal.id, provider: deal.paymentProvider, isTest: isTestProvider(deal.paymentProvider) });
  if (created && entry.status === "PENDING") await enqueueExecution(tx, deal.id, op.idempotencyKey);
  if (created && entry.status !== "PENDING") await onMoneyChanged(tx, deal.id, entry);
  return entry;
}

async function currentDocumentId(tx: Tx, dealId: string, kind: "CONTRACT" | "ACCEPTANCE_ACT"): Promise<string | null> {
  const doc = await tx.document.findFirst({ where: { dealId, kind, status: "SIGNED" }, orderBy: { version: "desc" }, select: { id: true } });
  return doc?.id ?? null;
}

/** Оплата покупателя: buyerTotal. Отклонённая банком попытка — следующая с новым ключом (hold:<id>:2). */
export async function requestHold(tx: Tx, deal: DealState, actorId: string): Promise<MoneyTransaction> {
  const attempts = await tx.moneyTransaction.count({ where: { dealId: deal.id, type: "HOLD" } });
  return record(tx, deal, {
    type: "HOLD",
    amountTiyn: deal.buyerTotalTiyn,
    idempotencyKey: moneyKey.hold(deal.id, attempts + 1),
    basisDocumentId: await currentDocumentId(tx, deal.id, "CONTRACT"),
    actorId,
  });
}

/**
 * Раскрытие: RELEASE = SPLIT_MASTER + SPLIT_PLATFORM (дочерние). Обычная выплата — от цены X;
 * частичный раздел по спору — от доли мастера Y той же формулой, остаток оплаченного — REFUND.
 */
export async function requestPayout(tx: Tx, deal: DealState, opts: { basisDocumentId: string | null; disputeId?: string; shareTiyn?: bigint }): Promise<void> {
  const split = computeSplit(deal.priceTiyn, opts.shareTiyn ?? deal.priceTiyn);
  const common = { disputeId: opts.disputeId, basisDocumentId: opts.basisDocumentId };
  const release = await record(tx, deal, { ...common, type: "RELEASE", amountTiyn: split.masterTiyn + split.platformTiyn, idempotencyKey: moneyKey.release(deal.id) });
  await record(tx, deal, { ...common, type: "SPLIT_MASTER", amountTiyn: split.masterTiyn, idempotencyKey: moneyKey.splitMaster(deal.id), parentId: release.id });
  await record(tx, deal, { ...common, type: "SPLIT_PLATFORM", amountTiyn: split.platformTiyn, idempotencyKey: moneyKey.splitPlatform(deal.id), parentId: release.id });
  if (split.refundTiyn > 0n) await requestRefund(tx, deal, split.refundTiyn, { disputeId: opts.disputeId });
}

export async function requestRefund(tx: Tx, deal: DealState, amountTiyn: bigint, opts: { disputeId?: string; actorId?: string } = {}): Promise<void> {
  await record(tx, deal, { type: "REFUND", amountTiyn, idempotencyKey: moneyKey.refund(deal.id), disputeId: opts.disputeId, actorId: opts.actorId });
}

/** Спор: выплата заморожена (деньги не двигаются, банку не отправляется) — и разморожена решением. */
export async function freezePayout(tx: Tx, deal: DealState, disputeId: string, actorId: string): Promise<void> {
  await record(tx, deal, { type: "FREEZE", amountTiyn: deal.payoutTiyn, idempotencyKey: moneyKey.freeze(disputeId), disputeId, actorId, settledNow: true });
}

export async function unfreezePayout(tx: Tx, deal: DealState, disputeId: string, actorId: string): Promise<void> {
  await record(tx, deal, { type: "UNFREEZE", amountTiyn: deal.payoutTiyn, idempotencyKey: moneyKey.unfreeze(disputeId), disputeId, actorId, settledNow: true });
}

// ─── изменение денег → уведомления ───────────────────────────────────────────

const n = ru.payments.notify;

function messagesFor(t: MoneyTransaction, dealNumber: number) {
  const amount = formatTiyn(t.amountTiyn);
  if (t.status === "FAILED") return t.type === "HOLD" ? { CLIENT: n.HOLD.FAILED.CLIENT(dealNumber), EXECUTOR: n.HOLD.FAILED.EXECUTOR(dealNumber) } : { CLIENT: n.failed.CLIENT(dealNumber), EXECUTOR: n.failed.EXECUTOR(dealNumber) };
  if (t.status !== "SUCCEEDED") return null;
  switch (t.type) {
    case "HOLD":
      return { CLIENT: n.HOLD.SUCCEEDED.CLIENT(dealNumber, amount), EXECUTOR: n.HOLD.SUCCEEDED.EXECUTOR(dealNumber, amount) };
    case "FREEZE":
    case "UNFREEZE":
      return { CLIENT: n[t.type].CLIENT(dealNumber), EXECUTOR: n[t.type].EXECUTOR(dealNumber) };
    case "SPLIT_MASTER":
    case "REFUND":
      return { CLIENT: n[t.type].CLIENT(dealNumber, amount), EXECUTOR: n[t.type].EXECUTOR(dealNumber, amount) };
    default:
      // RELEASE и SPLIT_PLATFORM — служебные: стороны узнают о выплате по SPLIT_MASTER.
      return null;
  }
}

/**
 * Единая точка «изменились деньги» (ТЗ п. 4, решение владельца 2.1.8): in-app уведомление ОБЕИМ сторонам
 * на каждую операцию с итогом; отказ банка (кроме оплаты) — ещё и операторам.
 * INTEGRATOR: сюда же платформа вешает web push (PushSubscription) — та же транзакция, тот же текст.
 */
export async function onMoneyChanged(tx: Tx, dealId: string, transaction: MoneyTransaction): Promise<void> {
  const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, select: { id: true, number: true, clientId: true, executor: { select: { userId: true } } } });
  const messages = messagesFor(transaction, deal.number);
  if (!messages) return;
  const kind = `money.${transaction.type.toLowerCase()}.${transaction.status.toLowerCase()}`;
  await notifyBoth(tx, deal, kind, messages);
  if (transaction.status === "FAILED" && transaction.type !== "HOLD") await notifyOperators(tx, kind, messages.CLIENT, dealLink(deal.id));
}

// ─── итог операции → статус сделки ───────────────────────────────────────────

/** Деньги ушли из банка целиком: выплата (обычная или раздел по спору) или полный возврат подтверждены. */
async function finishIfSettled(tx: Tx, deal: DealState): Promise<void> {
  const from = deal.status;
  if (canMove(deal, "SPLIT_PAYOUT", "SYSTEM")) {
    await moveDeal(tx, deal, { to: "SPLIT_PAYOUT", who: "SYSTEM", actor: SYSTEM_ACTOR, action: "deal.completed", data: { completedAt: new Date() } });
    // Грейд растёт после выплаты (Handover п. 4); раздел по спору — не завершённый заказ (OPEN_QUESTIONS).
    if (from === "ACCEPTED") {
      await tx.grade.upsert({ where: { executorId: deal.executorId }, create: { executorId: deal.executorId, completedOrdersCount: 1 }, update: { completedOrdersCount: { increment: 1 } } });
    }
    await notifyBoth(tx, deal, "deal.completed", { title: ru.deal.notify.completed.title, body: ru.deal.notify.completed.body(deal.number) });
    return;
  }
  if (canMove(deal, "REFUNDED", "SYSTEM")) {
    await moveDeal(tx, deal, { to: "REFUNDED", who: "SYSTEM", actor: SYSTEM_ACTOR, action: "deal.refunded", data: { cancelledAt: new Date() } });
  }
}

/**
 * Хук итога операции журнала (payments → deal-core, SettledHook): уведомить стороны и, если деньги это
 * позволяют, двинуть статус. HOLD подтверждён → PAID_HOLD; выплата или возврат подтверждены → конечный статус.
 * Идемпотентен: итог записывается один раз (trySettle), а переход проверяется таблицей.
 */
export const onMoneySettled: SettledHook = async (tx, settled) => {
  await onMoneyChanged(tx, settled.dealId, settled);
  if (settled.status !== "SUCCEEDED") return;
  const deal = await lockDeal(tx, settled.dealId);
  if (settled.type === "HOLD") {
    if (canMove(deal, "PAID_HOLD", "SYSTEM")) {
      await moveDeal(tx, deal, { to: "PAID_HOLD", who: "SYSTEM", actor: SYSTEM_ACTOR, action: "deal.paid", data: { paidAt: settled.settledAt ?? new Date() } });
    } else {
      // Деньги в банке, а сделка их не ждёт (например, отменена): разбирает оператор по журналу.
      logger.warn("hold settled but deal cannot move", { dealId: deal.id, status: deal.status });
    }
    return;
  }
  await finishIfSettled(tx, deal);
};

/**
 * Отправить ждущие операции сделки провайдеру сейчас (вне транзакции действия). mock подтверждает сразу —
 * статус сделки меняется до ответа экрану; manual ждёт оператора; сбой — подберёт задача или опрос.
 */
export function processDealMoney(dealId: string): Promise<Map<string, ProviderResult>> {
  return executeDealOperations(dealId, onMoneySettled);
}

