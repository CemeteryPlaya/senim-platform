"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { askSecondFactor, leaveIfSignedOut } from "@/modules/identity/client";
import type { ActionResult } from "@/platform/action";
import { focusFirstInvalid } from "@/ui";
import { verifySecondFactorAction } from "../mfa/actions";
import { MFA_CODE_FIELD, runWithCode } from "./second-factor";

/** Поля формы: строки и выбранные файлы (пустое поле файла не передаётся). */
export type FormFields = Record<string, string | File>;

type State = { error?: string; fieldErrors?: Record<string, string[]>; done?: boolean; needsCode?: boolean };

/**
 * Форма панели оператора: собирает поля, вызывает Server Action, показывает ошибки полей
 * и общий ответ, после успеха обновляет данные страницы. Проверка входа — на сервере (zod).
 * Действие ответило MFA_REQUIRED (деньги без свежего кода) — форма показывает поле кода (SecondFactorField);
 * следующая отправка сначала проверяет код, затем повторяет действие.
 */
export function useActionForm<T>(
  action: (fields: FormFields) => Promise<ActionResult<T>>,
  /** onSuccess получает и форму: очередь решений (DecisionQueue) находит по ней карточку. */
  opts: { reset?: boolean; onSuccess?: (data: T, form: HTMLFormElement) => void } = {},
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>({});

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields: FormFields = {};
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string") fields[key] = value;
      else if (value.size > 0) fields[key] = value;
    });
    // После отрисовки ошибок (aria-invalid) — фокус на первое неверное поле, а не на кнопке под ним.
    const focusInvalid = () => requestAnimationFrame(() => focusFirstInvalid(form));
    startTransition(async () => {
      const run = await runWithCode(fields, action, verifySecondFactorAction);
      const { result } = run;
      if (!result.ok) {
        if (leaveIfSignedOut(result)) return;
        if (run.step === "code") {
          setState({ needsCode: true, fieldErrors: { [MFA_CODE_FIELD]: [result.fieldErrors?.code?.[0] ?? result.error] } });
          focusInvalid();
          return;
        }
        if (askSecondFactor(result, (message) => setState({ needsCode: true, error: message }))) {
          requestAnimationFrame(() => form.querySelector<HTMLInputElement>(`[name="${MFA_CODE_FIELD}"]`)?.focus());
          return;
        }
        // Код принят, а действие отказало по своей причине: поле кода больше не нужно.
        setState((prev) => ({ error: result.error, fieldErrors: result.fieldErrors, needsCode: run.verified ? false : prev.needsCode }));
        if (result.fieldErrors) focusInvalid();
        return;
      }
      setState({ done: true });
      if (opts.reset) form.reset();
      opts.onSuccess?.(result.data, form);
      router.refresh();
    });
  };

  return {
    onSubmit,
    pending,
    error: state.error,
    done: state.done ?? false,
    /** Показать поле кода из приложения (SecondFactorField). */
    needsCode: state.needsCode ?? false,
    fieldError: (name: string) => state.fieldErrors?.[name]?.[0],
  };
}
