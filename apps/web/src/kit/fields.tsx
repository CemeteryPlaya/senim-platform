import { ChevronDown } from "lucide-react";
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

const labelClass = "text-sub font-medium text-ink";

const controlClass = cn(
  "w-full rounded-field border bg-surface px-4 text-body text-ink",
  "placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
);

const borderFor = (invalid: boolean) => (invalid ? "border-danger" : "border-line");

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
        className={cn(controlClass, "min-h-control py-3", borderFor(Boolean(error)), className)}
        {...rest}
        aria-describedby={describedBy(rest["aria-describedby"], errorId)}
      />
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}

export type SelectProps = Omit<ComponentProps<"select">, "name"> & FieldProps;

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
          className={cn(controlClass, "h-control appearance-none pr-12", borderFor(Boolean(error)), className)}
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
      <label htmlFor={id} className="flex min-h-control cursor-pointer items-center gap-3 text-body text-ink">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          className={cn("size-6 shrink-0 accent-action", className)}
          {...rest}
          aria-describedby={describedBy(rest["aria-describedby"], errorId)}
        />
        <span>{label}</span>
      </label>
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}

export type RadioCardProps = Omit<ComponentProps<"input">, "name" | "type"> & { label: string; name: string };

/** Вариант выбора в виде карточки: выбранная выделена линией 1 px цвета действия. Ошибка — у `RadioGroup`. */
export function RadioCard({ label, id: explicitId, className, ...rest }: RadioCardProps) {
  const auto = useId();
  const id = explicitId ?? auto;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-control cursor-pointer items-center gap-3 rounded-field border border-line bg-surface px-4 py-3 text-body text-ink",
        "transition-transform duration-100 active:scale-press has-checked:border-action",
      )}
    >
      <input id={id} type="radio" className={cn("size-6 shrink-0 accent-action", className)} {...rest} />
      <span>{label}</span>
    </label>
  );
}

export type RadioGroupProps = { legend: string; error?: string; children: ReactNode };

/** Группа карточек выбора: `fieldset` с `legend` и одной общей ошибкой. */
export function RadioGroup({ legend, error, children }: RadioGroupProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset aria-describedby={errorId} className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className={cn(labelClass, "mb-2")}>{legend}</legend>
      {children}
      <ErrorText id={errorId}>{error}</ErrorText>
    </fieldset>
  );
}
