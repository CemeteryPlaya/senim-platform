"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/platform/action";

export type ServerAction<I, T> = (input: I) => Promise<ActionResult<T>>;

/** Запуск Server Action: «Подождите…» на кнопке, ошибка рядом, после успеха — обновление экрана. */
export function useRunAction<I, T>(action: ServerAction<I, T>) {
  const router = useRouter();
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
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  };
  return { run, pending, error, fieldErrors };
}
