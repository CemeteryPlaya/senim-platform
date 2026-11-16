"use server";

import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { kycReviewSchema, reviewKyc } from "@/modules/operator";
import { action } from "@/platform/action";

/**
 * Решение по документам мастера: VERIFIED или REJECTED с причиной. `submittedAt` — время подачи из очереди: мастер
 * прислал новые документы, пока оператор смотрел старые, — identity откажет (CONFLICT), решение по старым не пройдёт.
 * Двойное нажатие и второй оператор — одно решение (условный переход в identity).
 */
export const reviewKycAction = action("app.operator.reviewKyc", z.unknown().pipe(kycReviewSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await reviewKyc(user, input.userId, input);
});
