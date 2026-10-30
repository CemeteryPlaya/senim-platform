"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

/** primary — важное, но обычное действие (принять этап, отметить оплату); danger — отмена, удаление, отказ. */
export type ConfirmTone = "primary" | "danger";

/** Тексты и тон подтверждения — так их передают кнопки действий экранов. */
export type ConfirmSpec = { title: string; text: ReactNode; yes: string; no: string; tone: ConfirmTone };

export type ConfirmDialogProps = {
  open: boolean;
  /** Отказ: кнопка отказа, крестик, Esc, клик по затемнению. */
  onCancel: () => void;
  onConfirm: () => void;
  title: ReactNode;
  /** Последствия простыми словами — диктор прочитает их вместе с заголовком (aria-describedby). */
  description: ReactNode;
  /** Подпись согласия: «Да, принять этап». */
  confirmLabel: ReactNode;
  /** Подпись отказа: «Не отменять», «Вернуться». */
  cancelLabel: ReactNode;
  /** Цвет кнопки согласия задаётся явно, а не по виду кнопки, открывшей окно. */
  tone: ConfirmTone;
  /** Идёт действие: кнопка согласия показывает индикатор и не нажимается повторно. */
  loading?: boolean;
  /** Например, ошибка сервера. */
  children?: ReactNode;
};

/** Подтверждение необратимого действия: заголовок-вопрос, последствия, «Нет» слева и «Да» справа. */
export function ConfirmDialog({ open, onCancel, onConfirm, title, description, confirmLabel, cancelLabel, tone, loading = false, children }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
