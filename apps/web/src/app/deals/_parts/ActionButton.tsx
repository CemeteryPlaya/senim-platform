"use client";

import type { ReactNode } from "react";
import { ConfirmButton, type ButtonVariant, type ConfirmSpec } from "@/ui";
import { useRunAction, type ServerAction } from "./useRunAction";

export type ActionButtonProps<I, T> = {
  action: ServerAction<I, T>;
  input: I;
  children: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Подтверждение перед необратимым действием; цвет кнопки согласия — confirm.tone. */
  confirm?: ConfirmSpec;
  /** id элемента, на который перевести фокус после успеха: кнопка после обновления экрана обычно исчезает. */
  focusAfter?: string;
  /** Доступное имя, когда видимого текста мало («Повторить операцию» — какую?). Начинается с видимого текста. */
  ariaLabel?: string;
};

/** Кнопка одного действия сделки. Повторное нажатие во время запроса заблокировано (loading). */
export function ActionButton<I, T>({ action, input, children, variant = "primary", fullWidth = true, confirm, focusAfter, ariaLabel }: ActionButtonProps<I, T>) {
  const { run, pending, error } = useRunAction(action);
  const onRun = () => run(input, focusAfter ? () => document.getElementById(focusAfter)?.focus() : undefined);
  return (
    <ConfirmButton onRun={onRun} pending={pending} error={error} variant={variant} fullWidth={fullWidth} confirm={confirm} ariaLabel={ariaLabel}>
      {children}
    </ConfirmButton>
  );
}
