import "server-only";
import { closeShowcasesOf } from "@/modules/deal-core";
import { resolveConsentRevocation, type CurrentUser, type RevocationDecision, type RevocationView } from "@/modules/identity";
import { transaction } from "@/platform/db";
import { logger } from "@/platform/logger";

/**
 * Решение оператора по заявке на отзыв согласия на ПДн (ADR-014). Само решение — в identity (условный переход, одно
 * решение на заявку); исполненный отзыв (COMPLETED) здесь же возвращает все сделки человека как покупателя к закрытому
 * показу в профилях мастеров (deal-core.closeShowcasesOf, спека 2026-11-17, 3.5). Отказ — выбор покупателя остаётся.
 * Права (OPERATOR, вторая ступень) проверяет identity.resolveConsentRevocation.
 */
export async function decideConsentRevocation(operator: CurrentUser, raw: RevocationDecision): Promise<RevocationView> {
  const { userId, ...view } = await resolveConsentRevocation(operator, raw);
  if (view.status !== "COMPLETED") return view;
  try {
    const closed = await transaction((tx) => closeShowcasesOf(tx, userId));
    logger.info("operator.consent_revocation.showcases_closed", { revocationId: view.id, closed });
  } catch (e) {
    // Отзыв в identity уже исполнен, повтор решения даст CONFLICT: сбой закрытия показа должен быть виден в журнале.
    logger.error("operator.consent_revocation.showcases_not_closed", { revocationId: view.id, userId, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  return view;
}
