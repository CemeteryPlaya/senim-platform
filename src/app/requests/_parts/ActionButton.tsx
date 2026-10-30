"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/platform/action";
import { Alert, Button, Modal, type ButtonVariant } from "@/ui";

export type ServerAction<I, T> = (input: I) => Promise<ActionResult<T>>;

/** Запускает Server Action и после успеха переходит по адресу или обновляет экран. Ошибку показывает рядом. */
export function useRunAction<I, T>(action: ServerAction<I, T>, after?: (data: T) => string | void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (input: I) =>
    new Promise<ActionResult<T>>((resolve) => {
      setError(null);
      startTransition(async () => {
        const result = await action(input);
        if (result.ok) {
          const href = after?.(result.data);
          if (href) router.push(href);
          else router.refresh();
        } else {
          setError(result.error);
        }
        resolve(result);
      });
    });
  return { run, pending, error };
}

export type ActionButtonProps<I, T> = {
  action: ServerAction<I, T>;
  input: I;
  children: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Куда перейти после успеха; без него экран обновляется на месте. */
  href?: string;
  /** Подтверждение перед необратимым действием. */
  confirm?: { title: string; text: ReactNode; yes: string; no: string };
};

/** Кнопка одного действия (выбрать отклик, отменить заявку, отозвать отклик) с подтверждением и ошибкой. */
export function ActionButton<I, T>({ action, input, children, variant = "primary", fullWidth, href, confirm }: ActionButtonProps<I, T>) {
  const { run, pending, error } = useRunAction(action, () => href);
  const [asking, setAsking] = useState(false);
  const go = () => {
    setAsking(false);
    void run(input);
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
                {confirm.no}
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

/** Ошибка формы целиком (сервер отказал); ошибки полей показывают сами поля. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert tone="danger" live="assertive">
      {message}
    </Alert>
  );
}
