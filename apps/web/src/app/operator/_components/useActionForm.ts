"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import type { ActionResult } from "@/platform/action";
import { focusFirstInvalid } from "@/ui";

/** Поля формы: строки и выбранные файлы (пустое поле файла не передаётся). */
export type FormFields = Record<string, string | File>;

type State = { error?: string; fieldErrors?: Record<string, string[]>; done?: boolean };

/**
 * Форма панели оператора: собирает поля, вызывает Server Action, показывает ошибки полей
 * и общий ответ, после успеха обновляет данные страницы. Проверка входа — на сервере (zod).
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
    startTransition(async () => {
      const result = await action(fields);
      if (!result.ok) {
        if (leaveIfSignedOut(result)) return;
        setState({ error: result.error, fieldErrors: result.fieldErrors });
        // После отрисовки ошибок (aria-invalid) — фокус на первое неверное поле, а не на кнопке под ним.
        if (result.fieldErrors) requestAnimationFrame(() => focusFirstInvalid(form));
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
    fieldError: (name: string) => state.fieldErrors?.[name]?.[0],
  };
}
