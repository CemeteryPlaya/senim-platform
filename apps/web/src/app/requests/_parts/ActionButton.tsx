"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import type { ActionResult } from "@/platform/action";
import { ConfirmButton, type ButtonVariant, type ConfirmSpec } from "@/ui";

export type ServerAction<I, T> = (input: I) => Promise<ActionResult<T>>;

/**
 * Запускает Server Action и после успеха переходит по адресу или обновляет экран. Ошибку показывает рядом;
 * сессия истекла — переход на вход с возвратом сюда, без ошибки. Промис всегда отдаёт результат действия.
 */
export function useRunAction<I, T>(action: ServerAction<I, T>, after?: (data: T) => string | void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const run = (input: I) =>
    new Promise<ActionResult<T>>((resolve) => {
      setError(null);
      setFieldErrors(undefined);
      startTransition(async () => {
        const result = await action(input);
        if (result.ok) {
          const href = after?.(result.data);
          if (href) router.push(href);
          else router.refresh();
        } else if (!leaveIfSignedOut(result)) {
          setError(result.error);
          setFieldErrors(result.fieldErrors);
        }
        resolve(result);
      });
    });
  return { run, pending, error, fieldErrors };
}

export type ActionButtonProps<I, T> = {
  action: ServerAction<I, T>;
  input: I;
  children: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Куда перейти после успеха; без него экран обновляется на месте. */
  href?: string;
  /** Подтверждение перед необратимым действием; цвет кнопки согласия — confirm.tone. */
  confirm?: ConfirmSpec;
};

/** Кнопка одного действия (выбрать отклик, отменить заявку, отозвать отклик) с подтверждением и ошибкой. */
export function ActionButton<I, T>({ action, input, children, variant = "primary", fullWidth, href, confirm }: ActionButtonProps<I, T>) {
  const { run, pending, error } = useRunAction(action, () => href);
  return (
    <ConfirmButton onRun={() => void run(input)} pending={pending} error={error} variant={variant} fullWidth={fullWidth} confirm={confirm}>
      {children}
    </ConfirmButton>
  );
}

export { FormError } from "@/ui";
