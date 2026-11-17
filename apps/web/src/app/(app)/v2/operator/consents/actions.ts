"use server";

import { z } from "zod";
import { requireUser, revocationDecisionSchema } from "@/modules/identity";
import { decideConsentRevocation } from "@/modules/operator";
import { action } from "@/platform/action";

/**
 * Решение по заявке на отзыв согласия: исполнить (COMPLETED) или отказать с причиной 3–500 символов (REFUSED). Двойное
 * нажатие и второй оператор — одно решение (условный переход в identity), остальным — CONFLICT «заявка уже рассмотрена».
 * Исполненный отзыв закрывает показ сделок покупателя в профилях мастеров (operator.decideConsentRevocation).
 */
export const resolveRevocationAction = action("app.operator.resolveConsentRevocation", z.unknown().pipe(revocationDecisionSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await decideConsentRevocation(user, input);
});
