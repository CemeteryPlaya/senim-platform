"use server";

import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { addExecutor, addExecutorSchema, changeSegment, changeSegmentSchema, reviewRegistration, reviewRegistrationSchema } from "@/modules/operator";
import { action } from "@/platform/action";

// Вход от браузера — неизвестные данные: схема разбирает их целиком (z.unknown().pipe).

export const reviewRegistrationAction = action("operator.reviewRegistration", z.unknown().pipe(reviewRegistrationSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await reviewRegistration(user, input);
});

export const addExecutorAction = action("operator.addExecutor", z.unknown().pipe(addExecutorSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  return addExecutor(user, input);
});

export const changeSegmentAction = action("operator.changeSegment", z.unknown().pipe(changeSegmentSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await changeSegment(user, input);
});
