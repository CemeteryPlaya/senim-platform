import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

/**
 * По макетам 7–19:
 * primary — зелёная кнопка главного действия («Подтвердить дату замера»); одна на экран.
 * secondary — белая с зелёной рамкой и зелёным текстом («Внести изменения», «Есть проблема»).
 * soft — мятная с зелёным текстом («Редактировать предложение», «Я мастер»).
 * ghost — текстовая ссылка-кнопка. danger — белая с красной рамкой («Открыть спор», «Отменить предложение»).
 * dangerSolid — красная заливка: согласие на необратимое в окне подтверждения.
 */
export type ButtonVariant = "primary" | "secondary" | "soft" | "ghost" | "danger" | "dangerSolid";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-primary bg-primary text-on-primary hover:border-primary-hover hover:bg-primary-hover",
  secondary: "border-primary bg-surface text-primary hover:bg-accent-soft",
  soft: "border-accent-soft bg-accent-soft text-primary hover:border-accent-soft-hover hover:bg-accent-soft-hover hover:text-primary-hover",
  ghost: "border-transparent bg-transparent text-primary underline decoration-line-strong underline-offset-4 hover:bg-accent-soft hover:decoration-primary",
  danger: "border-danger bg-surface text-danger hover:bg-danger-soft",
  dangerSolid: "border-danger bg-danger text-on-primary hover:border-danger-hover hover:bg-danger-hover",
};

type StyleOptions = {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** pill — компактная кнопка (48px), как «Войти» в шапке. Края у всех кнопок — «таблетка» (rounded-button). */
  shape?: "default" | "pill";
  className?: string;
};

/** Классы кнопки — для случаев, когда нужен не <button> и не <Link>. */
export function buttonClasses({ variant = "primary", fullWidth = false, shape = "default", className }: StyleOptions = {}): string {
  return cn(
    "inline-flex min-h-control items-center justify-center gap-2 border-2 px-6 py-2 active:translate-y-px",
    // При крупном шрифте на телефоне длинное слово переносится внутри кнопки, а не выталкивает её за край.
    "min-w-0 max-w-full break-words hyphens-auto",
    "text-center text-base font-bold leading-snug no-underline transition-colors duration-150",
    "disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    "rounded-button",
    shape === "pill" && "min-h-control-sm px-5",
    VARIANTS[variant],
    fullWidth && "w-full",
    className,
  );
}

type IconProps = {
  /** Иконка перед текстом (lucide-react); aria-hidden ставится автоматически. */
  icon?: ReactNode;
  /** Иконка после текста — в макетах стрелка у «Далее» и «Отправить заявку». */
  iconEnd?: ReactNode;
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-5">
      {children}
    </span>
  );
}

export type ButtonProps = ComponentProps<"button"> &
  StyleOptions &
  IconProps & {
    /**
     * Идёт действие: индикатор, aria-busy и aria-disabled; нажатие (и отправка формы) игнорируется.
     * Атрибут disabled не ставится намеренно: иначе браузер снимает фокус с кнопки и диктор теряет место.
     */
    loading?: boolean;
  };

/** Кнопка. По умолчанию type="button"; для отправки формы укажите type="submit". */
export function Button({ variant, fullWidth, shape, className, loading = false, icon, iconEnd, disabled, children, type = "button", onClick, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, fullWidth, shape, className })}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      // preventDefault у submit-кнопки отменяет и отправку формы (в том числе по Enter в поле).
      // Без loading обработчик — только переданный: кнопку используют и серверные компоненты (без функций в пропсах).
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />
      ) : (
        icon && <Icon>{icon}</Icon>
      )}
      <span>{children}</span>
      {iconEnd && !loading && <Icon>{iconEnd}</Icon>}
      {loading && <span className="sr-only">{ru.common.ui.pleaseWait}</span>}
    </button>
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & StyleOptions & IconProps;

/** Ссылка, которая выглядит как кнопка (переход на другую страницу). */
export function ButtonLink({ variant, fullWidth, shape, className, icon, iconEnd, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, fullWidth, shape, className })} {...rest}>
      {icon && <Icon>{icon}</Icon>}
      <span>{children}</span>
      {iconEnd && <Icon>{iconEnd}</Icon>}
    </Link>
  );
}
