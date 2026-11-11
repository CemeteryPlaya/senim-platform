"use server";

import { z } from "zod";
import { requireUser, revokePdConsent } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * Отзыв согласия на обработку ПДн своей учётной записи: заявка оператору со сроком 15 рабочих дней. Пользователь — из
 * сессии, id в запросе нет; открытая заявка уже есть — та же заявка.
 */
export const revokeConsentAction = action("consent.revoke", z.object({}), async () => {
  await requireUser("CLIENT", "EXECUTOR");
  const rev = await revokePdConsent();
  return { status: rev.status, dueAt: rev.dueAt };
});
