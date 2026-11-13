import { Check, ChevronDown } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

/** Общие пропсы полей: подпись и имя обязательны; текст ошибки показывается сразу под полем. */
export type FieldProps = {
  label: string;
  name: string;
  error?: string;
};

type Ids = { id: string; errorId: string | undefined };

/** Идентификаторы поля: ошибка связывается с ним через aria-describedby. */
function useFieldIds(explicitId: string | undefined, error: string | undefined): Ids {
  const auto = useId();
  const id = explicitId ?? auto;
  return { id, errorId: error ? `${id}-error` : undefined };
}

/** Свой aria-describedby вызывающего + связь с ошибкой. */
function describedBy(own: string | undefined, errorId: string | undefined): string | undefined {
  return [own, errorId].filter(Boolean).join(" ") || undefined;
}

/** Подпись поля и группы — 15 px / 500 в обеих версиях. */
const labelClass = "text-sub font-medium text-ink";

const controlClass = cn(
  "w-full rounded-field border bg-surface px-4 text-body text-ink",
  "placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
);

const borderFor = (invalid: boolean) => (invalid ? "border-danger" : "border-line-strong");

function ErrorText({ id, children }: { id: string | undefined; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-sub text-danger">
      {children}
    </p>
  );
}

export type TextFieldProps = Omit<ComponentProps<"input">, "name"> & FieldProps;

export function TextField({ label, error, id: explicitId, className, ...rest }: TextFieldProps) {
  const { id, errorId } = useFieldIds(explicitId, error);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(controlClass, "h-control", borderFor(Boolean(error)), className)}
        {...rest}
        aria-describedby={describedBy(rest["aria-describedby"], errorId)}
      />
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}

export type TextAreaProps = Omit<ComponentProps<"textarea">, "name"> & FieldProps;

/**
 * Многострочное поле без системного уголка изменения размера: высота растёт по содержимому (field-sizing: content)
 * от трёх строк (min-h-area). Где field-sizing не поддерживается, остаётся фиксированная высота в `rows` (4) строки.
 */
export function TextArea({ label, error, id: explicitId, className, rows = 4, ...rest }: TextAreaProps) {
  const { id, errorId } = useFieldIds(explicitId, error);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        className={cn(controlClass, "min-h-area resize-none field-sizing-content py-3", borderFor(Boolean(error)), className)}
        {...rest}
        aria-describedby={describedBy(rest["aria-describedby"], errorId)}
      />
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}

export type SelectProps = Omit<ComponentProps<"select">, "name"> & FieldProps;

/**
 * Выпадающий список. Подсказка пустого выбора — вариант `<option value="">`: пока выбран он, текст поля muted, как
 * placeholder текстового поля; выбранное значение и сам список вариантов — ink.
 */
export function Select({ label, error, id: explicitId, className, children, ...rest }: SelectProps) {
  const { id, errorId } = useFieldIds(explicitId, error);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          className={cn(
            controlClass,
            "h-control appearance-none pr-12 has-[option[value='']:checked]:text-muted [&>option]:text-ink",
            borderFor(Boolean(error)),
            className,
          )}
          {...rest}
          aria-describedby={describedBy(rest["aria-describedby"], errorId)}
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-muted" />
      </div>
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}

export type CheckboxProps = Omit<ComponentProps<"input">, "name" | "type"> & FieldProps;

export function Checkbox({ label, error, id: explicitId, className, ...rest }: CheckboxProps) {
  const { id, errorId } = useFieldIds(explicitId, error);
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-control cursor-pointer items-center gap-3 text-body text-ink",
          "has-disabled:cursor-not-allowed has-disabled:opacity-50",
        )}
      >
        {/* Нативный input скрыт визуально: состояние, клавиатура и диктор остаются нативными. */}
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          className={cn("peer sr-only", className)}
          {...rest}
          aria-describedby={describedBy(rest["aria-describedby"], errorId)}
        />
        <span
          aria-hidden
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-chip border bg-surface text-on-action",
            error ? "border-danger" : "border-line-strong",
            "peer-checked:border-action peer-checked:bg-action peer-checked:[&>svg]:opacity-100",
            "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
          )}
        >
          <Check className="size-4 opacity-0" />
        </span>
        <span>{label}</span>
      </label>
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}

export type RadioCardProps = Omit<ComponentProps<"input">, "name" | "type"> & {
  label: string;
  name: string;
  /** Вторая строка под подписью: вторичный текст 15 px `muted`; связана с радио через `aria-describedby`. */
  description?: string;
};

/** Вариант выбора в виде карточки: выбранная выделена линией 1 px цвета действия; `description` — вторая строка под подписью. Высота не ниже 48 px. Ошибка — у `RadioGroup`. */
export function RadioCard({ label, description, id: explicitId, className, ...rest }: RadioCardProps) {
  const auto = useId();
  const id = explicitId ?? auto;
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-control cursor-pointer items-center gap-3 rounded-field border border-line-strong bg-surface px-4 py-3 text-body text-ink",
        "pressable has-checked:border-action",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
        "has-disabled:cursor-not-allowed has-disabled:opacity-50",
      )}
    >
      <input id={id} type="radio" className={cn("peer sr-only", className)} {...rest} aria-describedby={describedBy(rest["aria-describedby"], descriptionId)} />
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong peer-checked:border-action peer-checked:[&>span]:opacity-100"
      >
        <span className="size-3 rounded-full bg-action opacity-0 radio-mark" />
      </span>
      {description ? (
        <span className="flex min-w-0 flex-col">
          <span>{label}</span>
          <span id={descriptionId} className="text-sub text-muted">
            {description}
          </span>
        </span>
      ) : (
        <span>{label}</span>
      )}
    </label>
  );
}

export type RadioGroupProps = {
  legend: string;
  error?: string;
  /**
   * Подпись группы только для экранного диктора (`sr-only`): вопрос уже задан заголовком экрана, а видимая подпись его
   * повторила бы. `legend` остаётся в разметке — у группы есть имя. Ошибка группы видна как обычно.
   */
  legendHidden?: boolean;
  children: ReactNode;
};

/** Группа карточек выбора: `fieldset` с `legend` и одной общей ошибкой. */
export function RadioGroup({ legend, error, legendHidden = false, children }: RadioGroupProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset aria-describedby={errorId} className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className={legendHidden ? "sr-only" : cn(labelClass, "mb-2")}>{legend}</legend>
      {children}
      <ErrorText id={errorId}>{error}</ErrorText>
    </fieldset>
  );
}
