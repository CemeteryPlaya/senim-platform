"use client";

import { useId } from "react";
import { ru } from "@/i18n/ru";
import { CodeField } from "@/kit";
import { MFA_CODE_FIELD, type ActionForm } from "../../../_shell/form";

/**
 * Поле кода из приложения-аутентификатора в форме действия оператора с деньгами: только после ответа MFA_REQUIRED
 * (`form.needsCode`, форма — `useOperatorForm`). Над полем — почему спрашивают (текст сервера), он же пояснение поля для
 * диктора; фокус в поле ставит форма. Ошибка кода (неверный, повтор, лимит) — под полем. Ставится в форму рядом с
 * кнопкой отправки: отправка с кодом сначала проверяет его, затем повторяет действие.
 */
export function SecondFactorField({ form }: { form: Pick<ActionForm, "needsCode" | "codeReason" | "fieldErrors"> }) {
  const reasonId = useId();
  if (!form.needsCode) return null;
  return (
    <div className="flex flex-col gap-2">
      <p id={reasonId} className="text-body text-ink">
        {form.codeReason}
      </p>
      <CodeField label={ru.app.operator.secondFactor.label} name={MFA_CODE_FIELD} aria-describedby={reasonId} error={form.fieldErrors[MFA_CODE_FIELD]} />
    </div>
  );
}
