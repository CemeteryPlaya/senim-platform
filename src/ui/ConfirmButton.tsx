"use client";

import { useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";
import { ConfirmDialog, type ConfirmSpec } from "./ConfirmDialog";
import { Alert } from "./display";

/** Ошибка формы целиком (сервер отказал); ошибки полей показывают сами поля. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Alert tone="danger" live="assertive">
      {message}
    </Alert>
  );
}

export type ConfirmButtonProps = {
  /** Действие после нажатия (или после согласия, если задан confirm). */
  onRun: () => void;
  pending: boolean;
  error: string | null;
  children: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Подтверждение перед необратимым действием; цвет кнопки согласия — confirm.tone. */
  confirm?: ConfirmSpec;
  ariaLabel?: string;
};

/** Кнопка одного действия: индикатор во время запроса, ошибка рядом, при необходимости — подтверждение. */
export function ConfirmButton({ onRun, pending, error, children, variant = "primary", fullWidth, confirm, ariaLabel }: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  const go = () => {
    setAsking(false);
    onRun();
  };

  return (
    <div className="flex flex-col gap-3">
      <Button variant={variant} fullWidth={fullWidth} loading={pending} aria-label={ariaLabel} onClick={confirm ? () => setAsking(true) : go}>
        {children}
      </Button>
      <FormError message={error} />
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
