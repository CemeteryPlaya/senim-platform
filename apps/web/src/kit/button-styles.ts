import { cn } from "./cn";

/** Варианты кнопки. Одна главная (`primary`) на экран, остальное — `secondary`, `quiet`, `danger`. */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
/**
 * `md` — 48 px; `sm` — второстепенные действия внутри карточек и действие в шапке компьютера (вторичная кнопка,
 * Ruling 25): база — доступная высота 48 px, на компьютере 36 px (`desktop:min-h-control-sm`). Главная — только `md`.
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

/** Отклик на наведение; у ожидающей не применяется, у отключённой гасится (not-disabled). */
const HOVER: Record<ButtonVariant, string> = {
  primary: "hover:not-disabled:opacity-90",
  secondary: "hover:not-disabled:opacity-80",
  quiet: "hover:not-disabled:bg-line",
  danger: "hover:not-disabled:opacity-80",
};

/**
 * Отключённая — одинаково у всех вариантов: подложка line, текст muted, без прозрачности (спокойная плашка, не
 * спорит с активными). Пара muted/line в светлой теме ~4,0:1 — для неактивных элементов контраст не нормируется
 * (WCAG 1.4.3), поэтому её нет в contrast.test.ts. Ожидающая (pending) — полный цвет варианта и индикатор.
 */
const DISABLED = "disabled:cursor-not-allowed disabled:bg-line disabled:text-muted";

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-control px-6 text-body",
  sm: "min-h-control desktop:min-h-control-sm px-4 text-sub",
};

/**
 * Классы по уже разобранным пропсам. Только для файлов kit (Button, ButtonLink): запрет `sm` у главной держит тип
 * пропсов компонента, а не эта функция; вне kit модуль не импортируется (сторож, правило 10).
 */
export function lookClasses({
  variant = "primary",
  size = "md",
  full = false,
  pending = false,
}: { variant?: ButtonVariant; size?: ButtonSize } & Extras): string {
  return cn(
    "relative inline-flex min-w-0 max-w-full items-center justify-center gap-2 rounded-control text-center font-semibold no-underline",
    "aria-disabled:cursor-not-allowed",
    SIZES[size],
    VARIANTS[variant],
    DISABLED,
    !pending && ["pressable", HOVER[variant]],
    full && "w-full",
  );
}

/** Классы кнопки — для случаев, когда нужен не `<button>` и не `<Link>`. */
export function buttonClasses(options: StyleOptions = {}): string {
  return lookClasses(options);
}

/** Метка главного действия: по ней тесты считают «одна главная кнопка на экран». */
export const primaryMark = (variant: ButtonVariant = "primary") => (variant === "primary" ? true : undefined);
