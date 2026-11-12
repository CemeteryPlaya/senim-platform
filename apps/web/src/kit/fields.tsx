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

const labelClass = "text-sub font-medium text-ink";

const controlClass = cn(
  "w-full rounded-field border bg-surface px-4 text-body text-ink",
  "placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
);

const borderFor = (invalid: boolean) => (invalid ? "border-danger" : "border-line");

function ErrorText({ id, children }: { id: string | undefined; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-sub text-danger">
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
        aria-describedby={errorId}
        className={cn(controlClass, "h-control", borderFor(Boolean(error)), className)}
        {...rest}
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
        aria-describedby={errorId}
        className={cn(controlClass, "min-h-control py-3", borderFor(Boolean(error)), className)}
        {...rest}
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
          aria-describedby={errorId}
          className={cn(controlClass, "h-control appearance-none pr-12", borderFor(Boolean(error)), className)}
          {...rest}
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
          aria-describedby={errorId}
          className={cn("size-6 shrink-0 accent-action", className)}
          {...rest}
        />
        <span>{label}</span>
      </label>
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}

export type RadioCardProps = Omit<ComponentProps<"input">, "name" | "type"> & FieldProps;

/** Вариант выбора в виде карточки: вся карточка нажимается, выбранная выделена линией цвета действия. */
export function RadioCard({ label, error, id: explicitId, className, ...rest }: RadioCardProps) {
  const { id, errorId } = useFieldIds(explicitId, error);
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-control cursor-pointer items-center gap-3 rounded-field border bg-surface px-4 py-3 text-body text-ink",
          "transition-transform duration-100 active:scale-press has-checked:border-action has-checked:ring-1 has-checked:ring-action",
          borderFor(Boolean(error)),
        )}
      >
        <input
          id={id}
          type="radio"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn("size-6 shrink-0 accent-action", className)}
          {...rest}
        />
        <span>{label}</span>
      </label>
      <ErrorText id={errorId}>{error}</ErrorText>
    </div>
  );
}
