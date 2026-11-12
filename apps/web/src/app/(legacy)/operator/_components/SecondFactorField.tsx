"use client";

import { ru } from "@/i18n/ru";
import { Input } from "@/ui";
import { MFA_CODE_FIELD } from "./second-factor";

const t = ru.identity.mfa;

/**
 * Поле кода из приложения-аутентификатора в форме действия с деньгами: только после ответа MFA_REQUIRED
 * (useActionForm.needsCode). Отправка формы с ним сначала проверяет код, затем повторяет действие.
 */
export function SecondFactorField({ form }: { form: { needsCode: boolean; fieldError: (name: string) => string | undefined } }) {
  if (!form.needsCode) return null;
  return (
    <Input
      label={t.stepUpLabel}
      hint={t.stepUpHint}
      name={MFA_CODE_FIELD}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={9}
      required
      error={form.fieldError(MFA_CODE_FIELD)}
    />
  );
}
