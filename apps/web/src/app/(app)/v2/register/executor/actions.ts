"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { executorRegistrationSchema, registerExecutor, requireUser, switchRole } from "@/modules/identity";
import { action } from "@/platform/action";
import { fail } from "@/platform/errors";
import { isAlreadyRegistered, v2Failure } from "./_parts/errors";
import { answersSchema, moduleInput } from "./_parts/schema";
import { REGISTER_PATH } from "./_parts/steps";

/**
 * «Отправить на проверку»: анкета мастера целиком (шаги держит браузер). Вход — схема v2 (ошибки у полей текстами v2), затем
 * `requireUser` первой строкой и модуль identity: роль мастера, реквизиты в identity, профиль на проверке, аудит и
 * уведомления операторам — в `registerExecutor`. Отказы — текстами v2 у полей (`v2Failure`).
 *
 * Двойная отправка даёт одну заявку: форма гасит повторное нажатие, модуль блокирует строку пользователя, а вторая отправка
 * («анкета уже подана») ведёт туда же, куда первая, — на экран статуса. После подачи активная роль — мастер (как в v1).
 * ИИН и БИН не попадают ни в журнал, ни в адрес: адрес возврата — без параметров, экран статуса показывает 4 цифры.
 */
export const registerMasterAction = action("app.masterRegister.submit", answersSchema, async (answers) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  const input = executorRegistrationSchema.safeParse(moduleInput(answers));
  // Схема v2 строже схемы модуля (schema.test.ts): сюда приходит только то, что модуль примет.
  if (!input.success) return fail.validation(ru.common.errors.invalid);
  try {
    await registerExecutor(user, input.data);
  } catch (e) {
    if (!isAlreadyRegistered(e)) throw v2Failure(e, answers.legalForm);
  }
  await switchRole(user, "EXECUTOR");
  // Активная роль сменилась: оболочка (вкладки, меню) перерисовывается вместе со страницей статуса, а не после перезагрузки.
  revalidatePath("/(app)", "layout");
  redirect(REGISTER_PATH);
});
