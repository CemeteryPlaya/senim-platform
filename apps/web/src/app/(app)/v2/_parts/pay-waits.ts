import "server-only";
import { bankConsentState, type NextStep } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { logger } from "@/platform/logger";
import { payWaitsMaster } from "./deal-summary";

/**
 * Сделки, где шаг покупателя — оплата, но она закрыта до согласия мастера для банка (`payWaitsMaster`). Отметки
 * читаются только для сделок на шаге оплаты (их единицы). Сбой чтения не роняет экран: сделка считается открытой для
 * оплаты (модуль сам откажет при попытке), в журнал — предупреждение.
 */
export async function payWaitingMaster(user: CurrentUser, nexts: ReadonlyMap<string, NextStep>): Promise<ReadonlySet<string>> {
  const ids = [...nexts].filter(([, next]) => next.action === "pay" && next.mine).map(([id]) => id);
  const states = await Promise.all(
    ids.map((id) =>
      bankConsentState(user, id).catch((error: unknown) => {
        logger.warn("bank consent state failed", { dealId: id, error });
        return null;
      }),
    ),
  );
  return new Set(ids.filter((id, index) => payWaitsMaster(nexts.get(id) ?? null, states[index] ?? null)));
}
