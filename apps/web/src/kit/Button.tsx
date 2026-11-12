import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

/**
 * Кнопка нового интерфейса. Одна главная (`primary`) на экран, остальное — `secondary`, `quiet`, `danger`.
 * Форма: радиус `rounded-control` (14 px на телефоне, 12 px на компьютере — решает токен), без обводки.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
/** `md` — 48 px; `sm` — 36 px, только для второстепенных действий внутри карточек. */
export type ButtonSize = "md" | "sm";

type StyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** На всю ширину контейнера. */
  full?: boolean;
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-action text-on-action hover:opacity-90",
  secondary: "bg-line text-ink hover:opacity-80",
  quiet: "bg-transparent text-ink hover:bg-line",
  danger: "bg-danger-soft text-danger hover:opacity-80",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-control px-6 text-body",
  sm: "min-h-control-sm px-4 text-sub",
};

/** Классы кнопки — для случаев, когда нужен не `<button>` и не `<Link>`. */
export function buttonClasses({ variant = "primary", size = "md", full = false }: StyleOptions = {}): string {
  return cn(
    "relative inline-flex min-w-0 max-w-full items-center justify-center gap-2 rounded-control text-center font-semibold no-underline",
    "transition-transform duration-100 active:scale-press",
    "disabled:cursor-not-allowed disabled:opacity-50",
    SIZES[size],
    VARIANTS[variant],
    full && "w-full",
  );
}

/** Метка главного действия: по ней тесты считают «одна главная кнопка на экран». */
const primaryMark = (variant: ButtonVariant = "primary") => (variant === "primary" ? true : undefined);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  StyleOptions & {
    /** Идёт действие: кнопка заблокирована, вместо подписи (ширина не меняется) виден индикатор. */
    pending?: boolean;
  };

/** По умолчанию `type="button"`; для отправки формы укажите `type="submit"`. */
export function Button({
  variant,
  size,
  full,
  pending = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses({ variant, size, full }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-primary-action={primaryMark(variant)}
      {...rest}
    >
      {/* Подпись остаётся в потоке (невидимая), поэтому ширина кнопки при ожидании не меняется. */}
      <span className={cn(pending && "invisible")}>{children}</span>
      {pending && (
        <>
          <Loader2 aria-hidden className="absolute size-5 animate-spin" />
          <span className="sr-only">{ru.app.kit.pending}</span>
        </>
      )}
    </button>
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & StyleOptions;

/** Ссылка, которая выглядит как кнопка (переход на другой экран). */
export function ButtonLink({ variant, size, full, className, ...rest }: ButtonLinkProps) {
  return (
    <Link
      className={cn(buttonClasses({ variant, size, full }), className)}
      data-primary-action={primaryMark(variant)}
      {...rest}
    />
  );
}
