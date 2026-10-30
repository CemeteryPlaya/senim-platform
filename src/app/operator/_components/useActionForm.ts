"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import type { ActionResult } from "@/platform/action";

export type FormFields = Record<string, string>;

type State = { error?: string; fieldErrors?: Record<string, string[]>; done?: boolean };

/**
 * Форма панели оператора: собирает поля, вызывает Server Action, показывает ошибки полей
 * и общий ответ, после успеха обновляет данные страницы. Проверка входа — на сервере (zod).
 */
export function useActionForm<T>(
  action: (fields: FormFields) => Promise<ActionResult<T>>,
  opts: { reset?: boolean; onSuccess?: (data: T) => void } = {},
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
    });
    startTransition(async () => {
      const result = await action(fields);
      if (!result.ok) {
        setState({ error: result.error, fieldErrors: result.fieldErrors });
        return;
      }
      setState({ done: true });
      if (opts.reset) form.reset();
      opts.onSuccess?.(result.data);
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
