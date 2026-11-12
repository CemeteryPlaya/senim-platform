"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import type { ActionResult } from "@/platform/action";
import { useFocusInvalid } from "@/ui";

export type ServerAction<I, T> = (input: I) => Promise<ActionResult<T>>;

/**
 * Запуск Server Action: «Подождите…» на кнопке, ошибка рядом, после успеха — обновление экрана;
 * сессия истекла — переход на вход с возвратом сюда.
 * Форма с полями вешает formRef на <form>: при ошибках полей фокус переходит на первое неверное поле.
 */
export function useRunAction<I, T>(action: ServerAction<I, T>) {
  const router = useRouter();
  const { ref: formRef, focusInvalid } = useFocusInvalid();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const run = (input: I, onDone?: (data: T) => void) => {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await action(input);
      if (result.ok) {
        onDone?.(result.data);
        router.refresh();
      } else if (!leaveIfSignedOut(result)) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        if (result.fieldErrors) focusInvalid();
      }
    });
  };
  return { run, pending, error, fieldErrors, formRef };
}
