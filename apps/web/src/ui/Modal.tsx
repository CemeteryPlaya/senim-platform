"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { isRepeatClick } from "./click-guard";
import { cn } from "./cn";

export type ModalProps = {
  open: boolean;
  /** Закрытие: крестик, Esc, клик по затемнению. Состояние open хранит вызывающий. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Кнопки внизу: главное действие последним (и в коде, и на экране). */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/**
 * Модальное окно на нативном <dialog>: браузер сам держит фокус внутри и делает
 * остальную страницу недоступной. После закрытия фокус возвращается туда, откуда открыли.
 * Повторные клики серии (detail > 1) гасятся: второй клик двойного нажатия, открывшего окно,
 * иначе попадает в «Да» или в затемнение (src/ui/click-guard.ts).
 */
export function Modal({ open, onClose, title, description, footer, className, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      if (opener.current instanceof HTMLElement) opener.current.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Esc: не даём браузеру закрыть окно в обход состояния — закрывает вызывающий.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Перехват до кнопок окна: повторный клик серии не доходит ни до «Да», ни до затемнения.
      onClickCapture={(event) => {
        if (!isRepeatClick(event.detail)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      // Клик по затемнению попадает в сам <dialog>, клик по содержимому — во внутренний div.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-card border border-line bg-surface p-0 text-ink shadow-overlay",
        "backdrop:bg-ink/60",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="pt-2 text-xl font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={ru.common.actions.close}
            className="-mr-2 inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink hover:bg-sunken"
          >
            <X aria-hidden className="size-6" />
          </button>
        </div>
        {description && (
          <p id={descriptionId} className="text-base text-ink-soft">
            {description}
          </p>
        )}
        {children}
        {footer && <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </dialog>
  );
}
