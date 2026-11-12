import { cn } from "./cn";

/** Варианты кнопки. Одна главная (`primary`) на экран, остальное — `secondary`, `quiet`, `danger`. */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
/** `md` — 48 px; `sm` — 36 px, только для второстепенных действий внутри карточек. */
export type ButtonSize = "md" | "sm";

export type StyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** На всю ширину контейнера. */
  full?: boolean;
  /** Ожидание: нет отклика на наведение и нажатие. */
  pending?: boolean;
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-action text-on-action",
  secondary: "bg-line text-ink",
  quiet: "bg-transparent text-ink",
  danger: "bg-danger-soft text-danger",
};

/** Отклик на наведение; в состоянии ожидания не применяется. */
const HOVER: Record<ButtonVariant, string> = {
  primary: "hover:opacity-90",
  secondary: "hover:opacity-80",
  quiet: "hover:bg-line",
  danger: "hover:opacity-80",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-control px-6 text-body",
  sm: "min-h-control-sm px-4 text-sub",
};

/** Классы кнопки — для случаев, когда нужен не `<button>` и не `<Link>`. */
export function buttonClasses({ variant = "primary", size = "md", full = false, pending = false }: StyleOptions = {}): string {
  return cn(
    "relative inline-flex min-w-0 max-w-full items-center justify-center gap-2 rounded-control text-center font-semibold no-underline",
    "transition-transform duration-100",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed",
    SIZES[size],
    VARIANTS[variant],
    !pending && ["active:scale-press", HOVER[variant]],
    pending && "opacity-50",
    full && "w-full",
  );
}

/** Метка главного действия: по ней тесты считают «одна главная кнопка на экран». */
export const primaryMark = (variant: ButtonVariant = "primary") => (variant === "primary" ? true : undefined);
