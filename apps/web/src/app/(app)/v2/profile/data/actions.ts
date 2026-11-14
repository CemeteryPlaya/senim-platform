"use server";

import { z } from "zod";
import { requireUser, revokePdConsent } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * Отзыв согласия на обработку данных своей учётной записи: заявка оператору со сроком 15 рабочих дней (identity). Согласие
 * действует до решения, человек остаётся в сервисе. Пользователь — из сессии, id в запросе нет. Повтор (двойное нажатие,
 * вторая вкладка) при открытой заявке возвращает ту же заявку: второй не появляется (открытая заявка — у identity).
 */
export const revokeConsentAction = action("app.profile.revokeConsent", z.strictObject({}), async () => {
  await requireUser("CLIENT", "EXECUTOR");
  const revocation = await revokePdConsent();
  return { status: revocation.status, dueAt: revocation.dueAt.toISOString() };
});
