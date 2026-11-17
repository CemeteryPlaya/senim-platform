import "server-only";
import { closeShowcasesOf } from "@/modules/deal-core";
import { consentRevocationQueue, resolveConsentRevocation, revocationDecisionSchema, type CurrentUser, type RevocationDecision, type RevocationView } from "@/modules/identity";
import { transaction } from "@/platform/db";
import { logger } from "@/platform/logger";
import { parseInput } from "@/platform/validation";

/**
 * Решение оператора по заявке на отзыв согласия на ПДн (ADR-014). Само решение — в identity (условный переход, одно
 * решение на заявку). При «исполнить» (COMPLETED) показ сделок человека как покупателя в профилях мастеров сначала
 * закрывается в web (deal-core.closeShowcasesOf, спека 2026-11-17, 3.5), и только потом решение уходит в identity:
 * обратный порядок при сбое web после исполненного отзыва оставил бы показ открытым без возможности повтора (identity
 * ответит «заявка уже рассмотрена»). Лишнее закрытие безопасно: если identity не принял решение, показ закрыт, а заявка
 * ещё открыта — покупатель может открыть показ снова. Отказ (REFUSED) выбор покупателя не трогает.
 * Права (OPERATOR, вторая ступень) проверяет identity: и очередь, и решение.
 */
export async function decideConsentRevocation(operator: CurrentUser, raw: RevocationDecision): Promise<RevocationView> {
  const input = parseInput(revocationDecisionSchema, raw);
  if (input.decision === "COMPLETED") await closeShowcasesFor(operator, input.revocationId);
  try {
    return await resolveConsentRevocation(operator, input);
  } catch (e) {
    if (input.decision === "COMPLETED") logger.warn("operator.consent_revocation.closed_before_failed_decision", { revocationId: input.revocationId });
    throw e;
  }
}

/**
 * Чья заявка — из очереди открытых заявок identity (тот же источник, что экран очереди). Заявки нет среди открытых
 * (уже рассмотрена или чужой id) — закрывать нечего: identity сам откажет в решении.
 */
async function closeShowcasesFor(operator: CurrentUser, revocationId: string): Promise<void> {
  const item = (await consentRevocationQueue(operator)).find((r) => r.id === revocationId);
  if (!item) return;
  const closed = await transaction((tx) => closeShowcasesOf(tx, item.userId));
  logger.info("operator.consent_revocation.showcases_closed", { revocationId, closed });
}
