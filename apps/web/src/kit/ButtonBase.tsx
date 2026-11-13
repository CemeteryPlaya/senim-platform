"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { ru } from "@/i18n/ru";
import { lookClasses, primaryMark, type StyleOptions } from "./button-styles";
import { cn } from "./cn";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  StyleOptions & {
    /**
     * Идёт действие: aria-disabled и aria-busy, нажатие (и повторная отправка формы) гасится, фокус не теряется.
     * Явный `disabled` вызывающего остаётся нативным.
     */
    pending?: boolean;
  };

/** Клиентская часть: нужен обработчик клика, гасящий повтор. По умолчанию `type="button"`. */
export function Button({
  variant,
  size,
  full,
  flush,
  pending = false,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(lookClasses({ variant, size, full, pending, flush }), className)}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      data-primary-action={primaryMark(variant)}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {/* Подпись остаётся в потоке и в доступном имени (прозрачная, не скрытая): ширина не меняется. */}
      <span className={cn(pending && "opacity-0")}>{children}</span>
      {pending && (
        <>
          <Loader2 aria-hidden className="absolute size-5 animate-spin" />
          <span className="sr-only">{`, ${ru.app.kit.pending.toLowerCase()}`}</span>
        </>
      )}
    </button>
  );
}
