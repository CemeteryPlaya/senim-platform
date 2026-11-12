import { cn } from "./cn";

/** Варианты кнопки. Одна главная (`primary`) на экран, остальное — `secondary`, `quiet`, `danger`. */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
/**
 * `md` — 48 px; `sm` — только второстепенные действия внутри карточек: 36 px на компьютере, на телефоне — 48 px
 * (высота касания). Главная кнопка бывает только `md`.
 */
export type ButtonSize = "md" | "sm";

/** Вариант и размер: у главной кнопки (`primary`, в том числе по умолчанию) размер только `md` — `sm` не собирается типом. */
export type ButtonLook =
  | { variant?: "primary"; size?: "md" }
  | { variant: Exclude<ButtonVariant, "primary">; size?: ButtonSize };

type Extras = {
  /** На всю ширину контейнера. */
  full?: boolean;
  /** Ожидание: нет отклика на наведение и нажатие. */
  pending?: boolean;
};

export type StyleOptions = ButtonLook & Extras;

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

/**
 * Отключённая и ожидающая кнопка — тот же цвет, приглушённый непрозрачностью. Главная — 0,4: тёмная (в тёмной теме
 * светлая) плашка не спорит с соседней обычной главной кнопкой; текст остаётся on-action.
 */
const DIMMED: Record<ButtonVariant, { disabled: string; pending: string }> = {
  primary: { disabled: "disabled:opacity-40", pending: "opacity-40" },
  secondary: { disabled: "disabled:opacity-50", pending: "opacity-50" },
  quiet: { disabled: "disabled:opacity-50", pending: "opacity-50" },
  danger: { disabled: "disabled:opacity-50", pending: "opacity-50" },
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-control px-6 text-body",
  sm: "min-h-control-sm mobile:min-h-control px-4 text-sub",
};

/**
 * Классы по уже разобранным пропсам (внутри kit: Button и ButtonLink). Запрет `sm` у главной держит тип пропсов
 * компонента, а не эта функция.
 */
export function lookClasses({
  variant = "primary",
  size = "md",
  full = false,
  pending = false,
}: { variant?: ButtonVariant; size?: ButtonSize } & Extras): string {
  return cn(
    "relative inline-flex min-w-0 max-w-full items-center justify-center gap-2 rounded-control text-center font-semibold no-underline",
    "transition-transform duration-100",
    "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed",
    DIMMED[variant].disabled,
    SIZES[size],
    VARIANTS[variant],
    !pending && ["active:scale-press", HOVER[variant]],
    pending && DIMMED[variant].pending,
    full && "w-full",
  );
}

/** Классы кнопки — для случаев, когда нужен не `<button>` и не `<Link>`. */
export function buttonClasses(options: StyleOptions = {}): string {
  return lookClasses(options);
}

/** Метка главного действия: по ней тесты считают «одна главная кнопка на экран». */
export const primaryMark = (variant: ButtonVariant = "primary") => (variant === "primary" ? true : undefined);
