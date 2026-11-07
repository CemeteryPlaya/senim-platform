import type { MoneyTransaction, Prisma } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import { notify } from "@/modules/notifications";
import { lockDealRow, transaction } from "@/platform/db";
import { logger } from "@/platform/logger";
import { formatTiyn } from "@/ui/format";
import { outcomeOf, settleFromProvider, type SettledHook } from "./execute";
import type { PaymentProviderName, WebhookResponse, WebhookResult } from "./provider";
import { providerFor, providerKindOf } from "./providers";

/**
 * Вебхук провайдера: /api/webhooks/payments/[provider]. Подпись проверяет провайдер (handleWebhook);
 * событие сохраняется с уникальным externalEventId — повторная доставка не обрабатывается дважды;
 * итог операции ищется по ключу идемпотентности и записывается только из PENDING.
 * Ответ провайдеру — тот, которого ждёт провайдер (WebhookResult.response).
 *
 * Уведомление, которое противоречит журналу (сумма или валюта не те, итог после уже записанного другого
 * итога — например, успех после отказа), журнал не меняет: событие сохраняется с ошибкой, операторы получают
 * уведомление и сверяют с банком. Провайдеру отвечаем как обычно: повтор доставки ничего не изменит.
 */

const REJECTED: WebhookResponse = { status: 400, contentType: "application/json", body: '{"ok":false}' };

export type WebhookOutcome = {
  response: WebhookResponse;
  processed: "settled" | "duplicate" | "ignored" | "rejected" | "unknown-operation" | "conflict" | "mismatch";
};

type Settled = Extract<WebhookResult, { kind: "settled" }>;
type Tx = Prisma.TransactionClient;

/** Событие сохранено впервые — true; повтор — false. */
async function storeEvent(tx: Tx, provider: ReturnType<typeof providerKindOf>, externalEventId: string, payload: string) {
  const inserted = await tx.paymentWebhookEvent.createMany({
    data: [{ provider, externalEventId, payload: { raw: payload } }],
    skipDuplicates: true,
  });
  return inserted.count === 1;
}

const closeEvent = (tx: Tx, externalEventId: string, error?: string) =>
  tx.paymentWebhookEvent.update({ where: { externalEventId }, data: { processedAt: new Date(), ...(error ? { error } : {}) } });

/** Сумма и валюта уведомления (если провайдер их сообщил) против операции журнала; null — совпадают. */
function amountProblem(op: MoneyTransaction, event: Settled): string | null {
  if (event.amountTiyn !== undefined && event.amountTiyn !== op.amountTiyn) return ru.payments.errors.amountMismatch(formatTiyn(op.amountTiyn), formatTiyn(event.amountTiyn));
  if (event.currency !== undefined && event.currency !== "KZT") return ru.payments.errors.amountMismatch(formatTiyn(op.amountTiyn), `${event.amountTiyn ?? ""} ${event.currency}`.trim());
  return null;
}

/** Итог уже записан, а провайдер сообщает другой: журнал не трогаем. */
function outcomeConflict(current: MoneyTransaction, event: Settled): string | null {
  const reported = event.result.status;
  return current.status !== "PENDING" && reported !== "PENDING" && reported !== current.status ? ru.payments.errors.lateOutcome(current.status, reported) : null;
}

async function alertOperators(tx: Tx, dealId: string, problem: string, externalEventId: string): Promise<void> {
  logger.warn("payment webhook contradicts ledger", { dealId, externalEventId, problem });
  const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, select: { number: true } });
  const operators = await tx.user.findMany({ where: { roles: { has: "OPERATOR" }, blockedAt: null }, select: { id: true } });
  const { title, body } = ru.payments.conflictNotice;
  for (const { id } of operators) await notify(tx, { userId: id, kind: "money.webhook.conflict", title, body: body(deal.number), link: `/operator/deals/${dealId}` });
}

async function processSettled(tx: Tx, kind: ReturnType<typeof providerKindOf>, event: Settled, onSettled: SettledHook): Promise<WebhookOutcome["processed"]> {
  const ref = await tx.moneyTransaction.findUnique({ where: { idempotencyKey: event.idempotencyKey }, select: { dealId: true, provider: true } });
  // Операция чужого провайдера или неизвестная: событие сохранено с ошибкой, деньги не трогаем.
  if (!ref || ref.provider !== kind) {
    await closeEvent(tx, event.externalEventId, "unknown operation");
    return "unknown-operation";
  }
  await lockDealRow(tx, ref.dealId);
  // Под блокировкой сделки: итог мог записать параллельный опрос или ответ провайдера.
  const op = await tx.moneyTransaction.findUniqueOrThrow({ where: { idempotencyKey: event.idempotencyKey } });
  const mismatch = amountProblem(op, event);
  const conflict = mismatch ? null : outcomeConflict(op, event);
  const problem = mismatch ?? conflict;
  if (problem) {
    await closeEvent(tx, event.externalEventId, problem);
    await alertOperators(tx, op.dealId, problem, event.externalEventId);
    return mismatch ? "mismatch" : "conflict";
  }
  if (event.result.status !== "PENDING") {
    await settleFromProvider(tx, op.id, outcomeOf(event.result), "webhook", onSettled, { externalEventId: event.externalEventId });
  }
  await closeEvent(tx, event.externalEventId);
  return "settled";
}

export async function receiveWebhook(name: PaymentProviderName, headers: Headers, body: string, onSettled: SettledHook): Promise<WebhookOutcome> {
  const kind = providerKindOf(name);
  const result = await providerFor(kind).handleWebhook({ headers, body });
  if (result.kind === "rejected") {
    logger.warn("payment webhook rejected", { provider: name, reason: result.reason });
    return { response: REJECTED, processed: "rejected" };
  }
  if (result.kind === "ignored") {
    if (result.externalEventId) await transaction((tx) => storeEvent(tx, kind, result.externalEventId!, body));
    return { response: result.response, processed: "ignored" };
  }
  const processed = await transaction(async (tx) => ((await storeEvent(tx, kind, result.externalEventId, body)) ? processSettled(tx, kind, result, onSettled) : "duplicate"));
  return { response: result.response, processed };
}
