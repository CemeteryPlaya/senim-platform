import "server-only";
import { bankConsentState, type BankConsentState, type NextStep } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { logger } from "@/platform/logger";
import { masterConsentMissing, payWaitsMaster } from "./deal-summary";

/**
 * Отметки «Передача данных банку» для сделок на шаге оплаты (их единицы). Сбой чтения не роняет экран: отметки считаются
 * неизвестными (`null` — сделка открыта для оплаты, модуль сам откажет при попытке), в журнал — предупреждение.
 */
async function bankStates(user: CurrentUser, ids: readonly string[]): Promise<(BankConsentState | null)[]> {
  return Promise.all(
    ids.map((id) =>
      bankConsentState(user, id).catch((error: unknown) => {
        logger.warn("bank consent state failed", { dealId: id, error });
        return null;
      }),
    ),
  );
}

/** Сделки, где шаг покупателя — оплата, но она закрыта до согласия мастера для банка (`payWaitsMaster`). */
export async function payWaitingMaster(user: CurrentUser, nexts: ReadonlyMap<string, NextStep>): Promise<ReadonlySet<string>> {
  const ids = [...nexts].filter(([, next]) => next.action === "pay" && next.mine).map(([id]) => id);
  const states = await bankStates(user, ids);
  return new Set(ids.filter((id, index) => payWaitsMaster(nexts.get(id) ?? null, states[index] ?? null)));
}

/** Сделки мастера, где оферта ждёт оплаты, а его согласия для банка нет — оплату закрывает он (`masterConsentMissing`). */
export async function consentMissingOf(user: CurrentUser, nexts: ReadonlyMap<string, NextStep>): Promise<ReadonlySet<string>> {
  const ids = [...nexts].filter(([, next]) => next.action === "waitPayment").map(([id]) => id);
  const states = await bankStates(user, ids);
  return new Set(ids.filter((id, index) => masterConsentMissing(nexts.get(id) ?? null, states[index] ?? null)));
}
