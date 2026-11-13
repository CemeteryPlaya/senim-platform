"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { recordOwnIdentity, requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError } from "@/platform/errors";
import { nextStepFor, safeNext } from "../../_shell/auth";
import { recallRole } from "../../_shell/role-cookie";

const t = ru.app.onboarding.welcome.errors;

/**
 * ФИО и ИИН: пустое — ошибка у поля до обращения к identity; формат ИИН, «ИИН уже занят», «уже указаны» и лимит попыток
 * проверяет identity (RecordPerson), его тексты приходят у полей. Пробелы в ИИН убираются («870304 300 612» → 12 цифр).
 * ИИН не попадает ни в журнал, ни в адрес, ни в сообщения об ошибках.
 */
const schema = z.strictObject({
  fullName: z.string().trim().min(1, t.fullNameRequired).max(200),
  iin: z
    .string()
    .max(20)
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(z.string().min(1, t.iinRequired)),
  next: z.string().max(2000).optional(),
});

/**
 * Отказ identity «ИИН уже указан в другом аккаунте» на экране v2 говорит «в другом профиле» (текст v2; v1 и общий модуль
 * остаются как есть), остальные отказы — как пришли.
 */
function v2Message(message: string): string {
  return message === ru.identity.clientIdentity.iinTaken ? t.iinTaken : message;
}

/**
 * Отказ identity «конфликт» (ИИН уже указан в другом аккаунте; ФИО и ИИН уже записаны и не меняются) — к полю ИИН: экран
 * показывает его под полем. Остальные отказы (лимит попыток, недоступность) остаются общей ошибкой формы.
 */
function atIinField(e: unknown): unknown {
  if (!(e instanceof AppError) || e.code !== "CONFLICT") return e;
  const message = v2Message(e.message);
  return new AppError(e.code, message, { ...e.details, fieldErrors: { iin: [message] } });
}

/**
 * «Продолжить» на знакомстве (№26): ФИО и ИИН один раз. Вход — requireUser: без согласия — CONSENT_REQUIRED (форма уводит
 * на экран согласия), без сессии — UNAUTHENTICATED. Ключ идемпотентности создаёт модуль identity. Дальше — первый
 * непройденный шаг (почта), `next` или дом; пользователь прочитан до записи (кэш на время запроса), поэтому в нём
 * дописываются ФИО и последние 4 цифры — иначе шаг вёл бы сам на себя.
 */
export const introduceAction = action("app.welcome.introduce", schema, async ({ fullName, iin, next }) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await recordOwnIdentity(user, { fullName, iin }).catch((e: unknown) => {
    throw atIinField(e);
  });
  const introduced = { ...user, fullName, iinLast4: iin.slice(-4) };
  redirect(nextStepFor(introduced, safeNext(next), await recallRole()));
});
