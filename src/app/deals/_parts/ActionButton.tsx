"use client";

import { useState, type ReactNode } from "react";
import { Alert, Button, ConfirmDialog, type ButtonVariant, type ConfirmSpec } from "@/ui";
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
  const [asking, setAsking] = useState(false);
  const go = () => {
    setAsking(false);
    run(input, focusAfter ? () => document.getElementById(focusAfter)?.focus() : undefined);
  };

  return (
    <div className="flex flex-col gap-3">
      <Button variant={variant} fullWidth={fullWidth} loading={pending} aria-label={ariaLabel} onClick={confirm ? () => setAsking(true) : go}>
        {children}
      </Button>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      {confirm && (
        <ConfirmDialog
          open={asking}
          onCancel={() => setAsking(false)}
          onConfirm={go}
          title={confirm.title}
          description={confirm.text}
          confirmLabel={confirm.yes}
          cancelLabel={confirm.no}
          tone={confirm.tone}
        />
      )}
    </div>
  );
}
