import type { MoneyTransaction } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { decryptPii } from "@/platform/crypto";
import { db, lockDealRow, transaction, type Db, type Tx } from "@/platform/db";
import { env } from "@/platform/env";
import { enqueueJob } from "@/platform/jobs";
import { logger } from "@/platform/logger";
import { rememberExternalRef, trySettle, type Outcome } from "./ledger";
import { heldOf } from "./projection";
import type { HeldPayment, PaymentProvider, ProviderResult } from "./provider";
import { providerFor } from "./providers";

/**
 * Исполнение операций журнала у провайдера. Операция сначала записывается (PENDING) в транзакции
 * изменения сделки, затем — уже вне её — уходит провайдеру с тем же ключом идемпотентности.
 * Сбой между записью и вызовом не теряет операцию: её подберёт задача (payments.executeDeal) или опрос.
 * Итог записывается условно (только из PENDING), и в той же транзакции вызывается хук deal-core.
 */

/** Хук владельца сделки: операция получила итог — двинуть статус, уведомить стороны. В транзакции итога. */
export type SettledHook = (tx: Tx, settled: MoneyTransaction) => Promise<void>;

export const JOB_EXECUTE_DEAL = "payments.executeDeal";

/** Поставить исполнение операций сделки в очередь (в транзакции записи): одна задача на операцию. */
export async function enqueueExecution(tx: Db, dealId: string, idempotencyKey: string): Promise<void> {
  await enqueueJob(tx, { kind: JOB_EXECUTE_DEAL, payload: { dealId }, dedupeKey: `money:${idempotencyKey}` });
}

/** Итог провайдера → журнал. Окончательный — условное обновление и хук; PENDING — только номер операции. */
export async function applyResult(op: Pick<MoneyTransaction, "id" | "dealId">, result: ProviderResult, onSettled: SettledHook): Promise<MoneyTransaction | null> {
  if (result.status === "PENDING") {
    if (result.externalRef) await rememberExternalRef(db, op.id, result.externalRef);
    return null;
  }
  return transaction(async (tx) => {
    await lockDealRow(tx, op.dealId);
    return settleFromProvider(tx, op.id, outcomeOf(result), "provider", onSettled);
  });
}

/** Окончательный ответ провайдера → итог операции журнала. */
export function outcomeOf(result: Exclude<ProviderResult, { status: "PENDING" }>): Outcome {
  return result.status === "SUCCEEDED" ? { status: "SUCCEEDED", externalRef: result.externalRef } : { status: "FAILED", error: result.error };
}

/**
 * Итог от провайдера (ответ на вызов, вебхук, опрос): условно из PENDING, запись в аудит от имени системы
 * и хук владельца сделки — в одной транзакции. null — итог уже был записан (повтор).
 */
export async function settleFromProvider(
  tx: Tx,
  id: string,
  outcome: Outcome,
  source: "provider" | "webhook" | "poll",
  onSettled: SettledHook,
  meta: Record<string, string> = {},
): Promise<MoneyTransaction | null> {
  const settled = await trySettle(tx, id, outcome);
  if (!settled) return null;
  await recordAudit(tx, {
    actor: SYSTEM(`payments.${source}`),
    action: settled.status === "SUCCEEDED" ? "payment.operation.succeeded" : "payment.operation.failed",
    entity: { type: "moneyTransaction", id: settled.id },
    scope: `deal:${settled.dealId}`,
    after: { status: settled.status, type: settled.type, amountTiyn: settled.amountTiyn.toString() },
    meta: { provider: settled.provider, ...(settled.error ? { error: settled.error } : {}), ...meta },
  });
  await onSettled(tx, settled);
  return settled;
}

type DealForProvider = { id: string; number: number; executor: { legalName: string; payoutIbanEnc: string | null } };

/** Подтверждённая оплата сделки для раскрытия и возврата; без неё деньгам нечего раскрывать или возвращать. */
function heldPayment(all: MoneyTransaction[]): HeldPayment | ProviderResult {
  const held = heldOf(all);
  return held ? { idempotencyKey: held.idempotencyKey, externalRef: held.externalRef } : { status: "FAILED", error: ru.payments.errors.noConfirmedHold };
}

async function callProvider(provider: PaymentProvider, deal: DealForProvider, op: MoneyTransaction, all: MoneyTransaction[]): Promise<[MoneyTransaction, ProviderResult][]> {
  const base = { dealId: deal.id, idempotencyKey: op.idempotencyKey, amountTiyn: op.amountTiyn };
  switch (op.type) {
    case "HOLD":
      return [[op, await provider.hold({ ...base, description: ru.payments.purpose(deal.number), returnUrl: `${env().APP_URL}/deals/${deal.id}` })]];
    case "RELEASE":
    case "REFUND": {
      const hold = heldPayment(all);
      if ("status" in hold) return [[op, hold]];
      return [[op, op.type === "RELEASE" ? await provider.release({ ...base, hold }) : await provider.refund({ ...base, hold, reason: ru.payments.refundReason(deal.number) })]];
    }
    case "SPLIT_MASTER":
    case "SPLIT_PLATFORM": {
      // Выплата мастеру и доход платформы — одним вызовом split по родительскому раскрытию; после повтора —
      // последние попытки (уже проведённая часть с прежним ключом провайдером не повторяется, итог не перезапишется).
      const master = all.findLast((t) => t.parentId === op.parentId && t.type === "SPLIT_MASTER");
      const platform = all.findLast((t) => t.parentId === op.parentId && t.type === "SPLIT_PLATFORM");
      if (!master || !platform) return [];
      const iban = deal.executor.payoutIbanEnc ? decryptPii(deal.executor.payoutIbanEnc) : null;
      const r = await provider.split({
        dealId: deal.id,
        master: { dealId: deal.id, idempotencyKey: master.idempotencyKey, amountTiyn: master.amountTiyn, recipient: { iban, name: deal.executor.legalName } },
        platform: { dealId: deal.id, idempotencyKey: platform.idempotencyKey, amountTiyn: platform.amountTiyn },
      });
      return [
        [master, r.master],
        [platform, r.platform],
      ];
    }
    default:
      return [];
  }
}

/**
 * Отправляет провайдеру все ждущие операции сделки по порядку журнала. Части выплаты — только после
 * подтверждённого раскрытия. Сбой провайдера не роняет вызывающего: операция остаётся PENDING до опроса;
 * сбой записи итога — роняет (см. executeOne).
 * Возвращает ответы провайдера по id операции (страница оплаты для HOLD — redirectUrl).
 */
export async function executeDealOperations(dealId: string, onSettled: SettledHook): Promise<Map<string, ProviderResult>> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { id: true, number: true, paymentProvider: true, executor: { select: { legalName: true, payoutIbanEnc: true } } },
  });
  const results = new Map<string, ProviderResult>();
  if (!deal) return results;
  const provider = providerFor(deal.paymentProvider);
  const all = await db.moneyTransaction.findMany({ where: { dealId }, orderBy: { seq: "asc" } });
  const run: Run = { provider, deal, all, onSettled, results, succeeded: new Set(all.filter((t) => t.status === "SUCCEEDED").map((t) => t.id)) };
  for (const op of all) await executeOne(run, op);
  return results;
}

type Run = {
  provider: PaymentProvider;
  deal: DealForProvider;
  all: MoneyTransaction[];
  onSettled: SettledHook;
  results: Map<string, ProviderResult>;
  /** Подтверждённые операции, включая проведённые в этом проходе: части выплаты ждут своё раскрытие. */
  succeeded: Set<string>;
};

/**
 * Одна ждущая операция. Сбой вызова провайдера (сеть, таймаут) — предупреждение: операция остаётся PENDING,
 * её подберут задача и опрос. Сбой записи итога или хука владельца сделки — ошибка и проброс: провайдер операцию
 * провёл, а журнал нет — задача payments.executeDeal должна упасть и повториться (тот же ключ, итог только из PENDING).
 */
async function executeOne(run: Run, op: MoneyTransaction): Promise<void> {
  if (op.status !== "PENDING" || run.results.has(op.id)) return;
  if (op.parentId && !run.succeeded.has(op.parentId)) return;
  let calls: [MoneyTransaction, ProviderResult][];
  try {
    calls = await callProvider(run.provider, run.deal, op, run.all);
  } catch (error) {
    logger.warn("payment provider call failed", { dealId: run.deal.id, idempotencyKey: op.idempotencyKey, error });
    return;
  }
  for (const [target, result] of calls) {
    run.results.set(target.id, result);
    try {
      const settled = await applyResult(target, result, run.onSettled);
      if (settled?.status === "SUCCEEDED") run.succeeded.add(settled.id);
    } catch (error) {
      logger.error("payment outcome not recorded", { dealId: run.deal.id, idempotencyKey: target.idempotencyKey, status: result.status, error });
      throw error;
    }
  }
}
