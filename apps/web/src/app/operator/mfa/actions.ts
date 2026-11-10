"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmTotpEnrollment, requireMfaUser, safeReturnTo, verifySecondFactor } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError } from "@/platform/errors";

// Код проверяет identity (формат — mfa.ts); здесь — только длина поля до разбора.
const codeInput = z.object({ code: z.string().max(32), next: z.string().max(500).optional() });

const OPERATOR_HOME = "/operator";

/** Ошибка кода — у поля кода: форма покажет её под полем (числа попыток, повтор кода). */
async function withCodeField(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    if (e instanceof AppError && (e.code === "VALIDATION" || e.code === "RATE_LIMITED" || e.code === "CONFLICT")) {
      throw new AppError(e.code, e.message, { fieldErrors: { code: [e.message] } });
    }
    throw e;
  }
}

/** Подключение приложения: первый верный код — и в кабинет (next — только путь внутри сайта). */
export const confirmEnrollmentAction = action("operator.confirmTotpEnrollment", codeInput, async ({ code, next }) => {
  const user = await requireMfaUser();
  await withCodeField(() => confirmTotpEnrollment(user, code));
  redirect(safeReturnTo(next) ?? OPERATOR_HOME);
});

/**
 * Код из приложения: вторая ступень входа (с next — переход туда) или повторный код перед действием с деньгами
 * (без next — форма сама повторяет действие).
 */
export const verifySecondFactorAction = action("operator.verifySecondFactor", codeInput, async ({ code, next }) => {
  const user = await requireMfaUser();
  await withCodeField(() => verifySecondFactor(user, code));
  if (next !== undefined) redirect(safeReturnTo(next) ?? OPERATOR_HOME);
});
