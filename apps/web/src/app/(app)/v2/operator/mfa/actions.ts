"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmTotpEnrollment, requireMfaUser, verifySecondFactor } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError } from "@/platform/errors";
import { safeNext } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";

/**
 * Код проверяет identity (формат — modules/identity/mfa.ts: шесть цифр, пробелы убираются); здесь — только длина полей до
 * разбора. `next` — возврат после второго шага входа (только путь v2 этого сайта, safeNext).
 */
const codeInput = z.strictObject({ code: z.string().max(32), next: z.string().max(2000).optional() });

/** Ошибка кода — у поля кода (`code`): неверный код с числом попыток, повтор кода, лимит, приложение не подключено. */
async function atCodeField(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    if (e instanceof AppError && (e.code === "VALIDATION" || e.code === "RATE_LIMITED" || e.code === "CONFLICT")) {
      throw new AppError(e.code, e.message, { ...e.details, fieldErrors: { code: [e.message] } });
    }
    throw e;
  }
}

/** Куда после второго шага: `next` (путь v2) или главная оператора. */
const afterMfa = (next: string | undefined): string => safeNext(next) ?? to("/operator");

/**
 * Подключение приложения-аутентификатора: первый верный код подключает его и проходит второй шаг этой сессии — дальше
 * `next` или главная оператора. Вход — `requireMfaUser` (сессия оператора, второй шаг ещё не пройден — это и есть экран).
 */
export const confirmEnrollmentAction = action("app.operator.confirmTotpEnrollment", codeInput, async ({ code, next }) => {
  const user = await requireMfaUser();
  await atCodeField(() => confirmTotpEnrollment(user, code));
  redirect(afterMfa(next));
});

/**
 * Код из приложения: второй шаг входа (с `next` — переход туда, без него на экране входа — на главную оператора) или
 * повторный код перед действием с деньгами (протокол формы `useOperatorForm`: без `next`, форма сама повторяет действие).
 */
export const verifySecondFactorAction = action("app.operator.verifySecondFactor", codeInput, async ({ code, next }) => {
  const user = await requireMfaUser();
  await atCodeField(() => verifySecondFactor(user, code));
  if (next !== undefined) redirect(afterMfa(next));
});
