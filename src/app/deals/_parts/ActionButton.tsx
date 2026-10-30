"use client";

import { useState, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, Modal, type ButtonVariant } from "@/ui";
import { useRunAction, type ServerAction } from "./useRunAction";

export type ActionButtonProps<I, T> = {
  action: ServerAction<I, T>;
  input: I;
  children: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Подтверждение перед необратимым действием. */
  confirm?: { title: string; text: ReactNode; yes: string };
};

/** Кнопка одного действия сделки. Повторное нажатие во время запроса заблокировано (loading). */
export function ActionButton<I, T>({ action, input, children, variant = "primary", fullWidth = true, confirm }: ActionButtonProps<I, T>) {
  const { run, pending, error } = useRunAction(action);
  const [asking, setAsking] = useState(false);
  const go = () => {
    setAsking(false);
    run(input);
  };

  return (
    <div className="flex flex-col gap-3">
      <Button variant={variant} fullWidth={fullWidth} loading={pending} onClick={confirm ? () => setAsking(true) : go}>
        {children}
      </Button>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      {confirm && (
        <Modal
          open={asking}
          onClose={() => setAsking(false)}
          title={confirm.title}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {ru.common.actions.cancel}
              </Button>
              <Button variant={variant === "danger" ? "danger" : "primary"} onClick={go}>
                {confirm.yes}
              </Button>
            </>
          }
        >
          <p className="text-base text-ink">{confirm.text}</p>
        </Modal>
      )}
    </div>
  );
}
