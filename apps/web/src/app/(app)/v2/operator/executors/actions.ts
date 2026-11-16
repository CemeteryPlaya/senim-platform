"use server";

import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { addExecutor, addExecutorSchema, changeSegment, changeSegmentSchema, reviewRegistration, reviewRegistrationSchema } from "@/modules/operator";
import { action } from "@/platform/action";

// Вход от браузера — неизвестные данные: схема модуля разбирает их целиком (z.unknown().pipe), затем роль — первой строкой.

/** Подтвердить регистрацию с сегментом или отклонить с причиной; повторное решение — CONFLICT в identity. */
export const reviewRegistrationAction = action("app.operator.reviewRegistration", z.unknown().pipe(reviewRegistrationSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await reviewRegistration(user, input);
});

/** Добавить исполнителя вручную: сразу подтверждён; номер с профилем — CONFLICT. Ответ — id профиля для перехода на карточку. */
export const addExecutorAction = action("app.operator.addExecutor", z.unknown().pipe(addExecutorSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  return addExecutor(user, input);
});

/** Сменить сегмент подтверждённому: `from` — сегмент, который видел оператор (защита от гонки), причина — в журнал и уведомление. */
export const changeSegmentAction = action("app.operator.changeSegment", z.unknown().pipe(changeSegmentSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await changeSegment(user, input);
});
