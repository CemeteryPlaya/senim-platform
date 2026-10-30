"use client";

import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

/** Общие пропсы поля: подпись обязательна, подсказка и ошибка — по необходимости. */
export type FieldBaseProps = {
  label: ReactNode;
  hint?: ReactNode;
  /** Текст ошибки. Есть ошибка — поле получает aria-invalid и рамку цвета ошибки. */
  error?: ReactNode;
  /** Пометка «необязательно» рядом с подписью. */
  optional?: boolean;
};

type FieldIds = { id: string; hintId?: string; errorId?: string; describedBy?: string };

function useFieldIds(explicitId: string | undefined, hint: ReactNode, error: ReactNode): FieldIds {
  const autoId = useId();
  const id = explicitId ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return { id, hintId, errorId, describedBy };
}

const labelClass = "text-base font-semibold text-ink";

function LabelText({ label, optional }: { label: ReactNode; optional?: boolean }) {
  return (
    <>
      {label}
      {optional && <span className="font-normal text-muted"> ({ru.common.ui.optional})</span>}
    </>
  );
}

function Hint({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-sm text-muted">
      {children}
    </p>
  );
}

function ErrorText({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="flex items-start gap-2 text-sm font-semibold text-danger">
      <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

const controlClass = cn(
  "block w-full min-h-control rounded-control border border-line-strong bg-surface px-4 py-2",
  "text-base text-ink placeholder:text-muted transition-colors duration-150",
  "hover:border-ink focus-visible:border-primary",
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted",
  "aria-invalid:border-2 aria-invalid:border-danger",
);

function Shell({ ids, label, hint, error, optional, children }: FieldBaseProps & { ids: FieldIds; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={ids.id} className={labelClass}>
        <LabelText label={label} optional={optional} />
      </label>
      <Hint id={ids.hintId}>{hint}</Hint>
      {children}
      <ErrorText id={ids.errorId}>{error}</ErrorText>
    </div>
  );
}

export type InputProps = Omit<ComponentProps<"input">, "size"> & FieldBaseProps;

/** Однострочное поле. Для телефона: type="tel" inputMode="tel" autoComplete="tel". */
export function Input({ label, hint, error, optional, id, className, ...rest }: InputProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Shell ids={ids} label={label} hint={hint} error={error} optional={optional}>
      <input
        id={ids.id}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(controlClass, className)}
        {...rest}
      />
    </Shell>
  );
}

export type TextareaProps = ComponentProps<"textarea"> & FieldBaseProps;

/** Многострочное поле. */
export function Textarea({ label, hint, error, optional, id, className, rows = 4, ...rest }: TextareaProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Shell ids={ids} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={ids.id}
        rows={rows}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(controlClass, "resize-y leading-relaxed", className)}
        {...rest}
      />
    </Shell>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<ComponentProps<"select">, "children"> &
  FieldBaseProps & {
    options: readonly SelectOption[];
    /** Пустой первый пункт. По умолчанию — «Выберите вариант»; false — без него. */
    placeholder?: string | false;
  };

/** Выпадающий список на нативном <select> — привычен на телефоне. */
export function Select({ label, hint, error, optional, id, className, options, placeholder, ...rest }: SelectProps) {
  const ids = useFieldIds(id, hint, error);
  const empty = placeholder === false ? null : (placeholder ?? ru.common.ui.selectPlaceholder);
  return (
    <Shell ids={ids} label={label} hint={hint} error={error} optional={optional}>
      <div className="relative">
        <select
          id={ids.id}
          aria-describedby={ids.describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(controlClass, "appearance-none pr-12", className)}
          {...rest}
        >
          {empty !== null && <option value="">{empty}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-ink" />
      </div>
    </Shell>
  );
}

export type CheckboxProps = Omit<ComponentProps<"input">, "type" | "size"> & FieldBaseProps;

/** Флажок с подписью справа; вся строка — зона нажатия не меньше 48px. */
export function Checkbox({ label, hint, error, optional, id, className, ...rest }: CheckboxProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={ids.id} className="flex min-h-control-sm cursor-pointer items-center gap-3 text-base text-ink">
        <input
          id={ids.id}
          type="checkbox"
          aria-describedby={ids.describedBy}
          aria-invalid={error ? true : undefined}
          className="size-6 shrink-0 cursor-pointer accent-primary"
          {...rest}
        />
        <span>
          <LabelText label={label} optional={optional} />
        </span>
      </label>
      <div className="flex flex-col gap-1 pl-9">
        <Hint id={ids.hintId}>{hint}</Hint>
        <ErrorText id={ids.errorId}>{error}</ErrorText>
      </div>
    </div>
  );
}

export type RadioCardOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  /** Иконка слева от подписи (для карточек без картинки). */
  icon?: ReactNode;
  /** Картинка сверху карточки — стиль, сегмент (как в макетах); с картинками на телефоне две колонки. */
  image?: { src: string; alt: string };
  disabled?: boolean;
};

export type RadioCardsProps = FieldBaseProps & {
  name: string;
  options: readonly RadioCardOption[];
  /** Управляемый режим. */
  value?: string;
  onChange?: (value: string) => void;
  /** Неуправляемый режим (обычная форма / Server Action). */
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  /** Колонок на широком экране; на телефоне — одна (с картинками — две). */
  columns?: 1 | 2 | 3;
  id?: string;
};

const COLUMNS: Record<NonNullable<RadioCardsProps["columns"]>, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * Выбор одного варианта крупными карточками (тип мебели, стиль, сегмент).
 * Выбранная карточка — зелёная рамка и галочка в круге справа сверху, как в макетах.
 */
export function RadioCards({ label, hint, error, optional, name, options, value, onChange, defaultValue, required, disabled, columns = 1, id }: RadioCardsProps) {
  const ids = useFieldIds(id, hint, error);
  const controlled = value !== undefined;
  const withImages = options.some((o) => o.image);
  return (
    <fieldset
      id={ids.id}
      aria-describedby={ids.describedBy}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
      className="flex min-w-0 flex-col gap-2"
    >
      <legend className={cn(labelClass, "mb-2")}>
        <LabelText label={label} optional={optional} />
      </legend>
      <Hint id={ids.hintId}>{hint}</Hint>
      <div className={cn("grid gap-3", withImages && "grid-cols-2", COLUMNS[columns])}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "group relative flex min-h-control min-w-0 cursor-pointer flex-col overflow-hidden rounded-card border-2 bg-surface shadow-card",
              "transition-colors duration-150 hover:border-line-strong",
              error ? "border-danger" : "border-line",
              "has-checked:border-primary",
              "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
              "has-disabled:cursor-not-allowed has-disabled:opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              required={required}
              disabled={o.disabled}
              className="sr-only"
              {...(controlled ? { checked: value === o.value, onChange: () => onChange?.(o.value) } : { defaultChecked: defaultValue === o.value })}
            />
            {o.image && (
              // Картинки из каталога и хранилища: размеры заранее неизвестны, оптимизация next/image здесь не нужна.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.image.src} alt={o.image.alt} loading="lazy" className="aspect-[16/10] w-full object-cover" />
            )}
            <span className={cn("flex min-w-0 items-start gap-3 p-4", !o.image && "pr-14")}>
              {o.icon && <span aria-hidden className="mt-0.5 inline-flex shrink-0 text-primary [&_svg]:size-6">{o.icon}</span>}
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-base font-bold text-ink">{o.label}</span>
                {o.description && <span className="text-sm text-muted">{o.description}</span>}
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                "absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-full border-2 border-line-strong bg-surface text-on-primary",
                "group-has-checked:border-primary group-has-checked:bg-primary",
              )}
            >
              <Check className="size-4 opacity-0 group-has-checked:opacity-100" strokeWidth={3} />
            </span>
          </label>
        ))}
      </div>
      <ErrorText id={ids.errorId}>{error}</ErrorText>
    </fieldset>
  );
}
