"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { recordOwnIdentity, requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
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
 * «Продолжить» на знакомстве (№26): ФИО и ИИН один раз. Вход — requireUser: без согласия — CONSENT_REQUIRED (форма уводит
 * на экран согласия), без сессии — UNAUTHENTICATED. Ключ идемпотентности создаёт модуль identity. Дальше — первый
 * непройденный шаг (почта), `next` или дом; пользователь прочитан до записи (кэш на время запроса), поэтому в нём
 * дописываются ФИО и последние 4 цифры — иначе шаг вёл бы сам на себя.
 */
export const introduceAction = action("app.welcome.introduce", schema, async ({ fullName, iin, next }) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await recordOwnIdentity(user, { fullName, iin });
  const introduced = { ...user, fullName, iinLast4: iin.slice(-4) };
  redirect(nextStepFor(introduced, safeNext(next), await recallRole()));
});
