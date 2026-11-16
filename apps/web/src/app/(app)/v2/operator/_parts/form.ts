"use client";

import type { ActionResult } from "@/platform/action";
import { useActionForm, type ActionForm, type UseActionFormOptions } from "../../../_shell/form";
import { verifySecondFactorAction } from "../mfa/actions";

/**
 * Форма оператора v2: `useActionForm` с протоколом второго фактора. Действие с деньгами (подтверждение, отказ и повтор
 * операции банка, решение спора) отвечает MFA_REQUIRED, если код из приложения вводили давно, — форма показывает поле кода
 * (`SecondFactorField`), следующая отправка проверяет код (`verifySecondFactorAction`) и повторяет действие. Остальное —
 * как у `useActionForm` (ошибки у полей, «сессия истекла» — на вход с возвратом, двойная отправка гасится).
 */
export function useOperatorForm<I, T>(
  action: (input: I) => Promise<ActionResult<T>>,
  options: Omit<UseActionFormOptions<I, T>, "verifyCode"> = {},
): ActionForm {
  return useActionForm(action, { ...options, verifyCode: verifySecondFactorAction });
}
