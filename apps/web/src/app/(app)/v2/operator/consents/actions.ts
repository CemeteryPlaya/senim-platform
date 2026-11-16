"use server";

import { z } from "zod";
import { requireUser, resolveConsentRevocation, revocationDecisionSchema } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * Решение по заявке на отзыв согласия: исполнить (COMPLETED) или отказать с причиной 3–500 символов (REFUSED). Двойное
 * нажатие и второй оператор — одно решение (условный переход в identity), остальным — CONFLICT «заявка уже рассмотрена».
 */
export const resolveRevocationAction = action("app.operator.resolveConsentRevocation", z.unknown().pipe(revocationDecisionSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await resolveConsentRevocation(user, input);
});
