import type { Prisma } from "@/generated/prisma/client";
import { lockDealRow, transaction } from "@/platform/db";
import { logger } from "@/platform/logger";
import { outcomeOf, settleFromProvider, type SettledHook } from "./execute";
import type { PaymentProviderName, WebhookResponse } from "./provider";
import { providerFor, providerKindOf } from "./providers";

/**
 * Вебхук провайдера: /api/webhooks/payments/[provider]. Подпись проверяет провайдер (handleWebhook);
 * событие сохраняется с уникальным externalEventId — повторная доставка не обрабатывается дважды;
 * итог операции ищется по ключу идемпотентности и записывается только из PENDING.
 * Ответ провайдеру — тот, которого ждёт провайдер (WebhookResult.response).
 */

const REJECTED: WebhookResponse = { status: 400, contentType: "application/json", body: '{"ok":false}' };

export type WebhookOutcome = { response: WebhookResponse; processed: "settled" | "duplicate" | "ignored" | "rejected" | "unknown-operation" };

/** Событие сохранено впервые — true; повтор — false. */
async function storeEvent(tx: Prisma.TransactionClient, provider: ReturnType<typeof providerKindOf>, externalEventId: string, payload: string) {
  const inserted = await tx.paymentWebhookEvent.createMany({
    data: [{ provider, externalEventId, payload: { raw: payload } }],
    skipDuplicates: true,
  });
  return inserted.count === 1;
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

  const processed = await transaction(async (tx): Promise<WebhookOutcome["processed"]> => {
    if (!(await storeEvent(tx, kind, result.externalEventId, body))) return "duplicate";
    const op = await tx.moneyTransaction.findUnique({ where: { idempotencyKey: result.idempotencyKey } });
    // Операция чужого провайдера или неизвестная: событие сохранено с ошибкой, деньги не трогаем.
    if (!op || op.provider !== kind) {
      await tx.paymentWebhookEvent.update({ where: { externalEventId: result.externalEventId }, data: { error: "unknown operation", processedAt: new Date() } });
      return "unknown-operation";
    }
    await lockDealRow(tx, op.dealId);
    if (result.result.status !== "PENDING") {
      await settleFromProvider(tx, op.id, outcomeOf(result.result), "webhook", onSettled, { externalEventId: result.externalEventId });
    }
    await tx.paymentWebhookEvent.update({ where: { externalEventId: result.externalEventId }, data: { processedAt: new Date() } });
    return "settled";
  });
  return { response: result.response, processed };
}
