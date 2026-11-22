import { Check, ChevronDown } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
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

export function TextField(props: TextFieldProps) {
  return <InputField {...props} />;
}

/**
 * Внутреннее поле kit (не в `@/kit`): то же, что `TextField`, плюс то, что нужно полям с маской.
 * - `name` необязателен: у поля с маской имя и значение для формы — у скрытого поля рядом, а видимое несёт `data-field`
 *   (по нему `useActionForm` снимает ошибку поля при правке и находит поле с ошибкой).
 * - `prefix` / `suffix` — неизменяемая часть внутри рамки («+7», «@», «₸»): видна всегда, для диктора скрыта (подпись поля
 *   называет, что вводить), нажатие сквозь неё попадает в поле.
 * - `after` — строка под полем и ошибкой (подсказка исправления, расчёт «Вы получите»).
 * - `trailing` — кнопка 48 px внутри рамки справа (стрелка списка у поля «Город»); вместо `suffix`.
 */
export type InputFieldProps = Omit<ComponentProps<"input">, "prefix"> & {
  label: string;
  error?: string;
  prefix?: string;
  suffix?: string;
  after?: ReactNode;
  trailing?: ReactNode;
};

export function InputField({ label, error, id: explicitId, className, prefix, suffix, after, trailing, ...rest }: InputFieldProps) {
  const { id, errorId } = useFieldIds(explicitId, error);
  const input = (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      className={cn(
        controlClass,
        "h-control",
        borderFor(Boolean(error)),
        // Отступ под приставку и знак — 40 px, мимо шкалы: место под «+7» / «₸» (≈ 18 px при 17 px) и зазор как пробел.
        prefix && "pl-10",
        suffix && "pr-10",
        trailing && "pr-14",
        className,
      )}
      {...rest}
      aria-describedby={describedBy(rest["aria-describedby"], errorId)}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {prefix || suffix || trailing ? (
        <div className="relative">
          {input}
          {trailing && <div className="absolute inset-y-0 right-0 flex items-center">{trailing}</div>}
          {prefix && (
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-body text-ink">
              {prefix}
            </span>
          )}
          {suffix && (
            <span aria-hidden className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-body text-muted">
              {suffix}
            </span>
          )}
        </div>
      ) : (
        input
      )}
      <ErrorText id={errorId}>{error}</ErrorText>
      {after}
    </div>
  );
}

export type TextAreaProps = Omit<ComponentProps<"textarea">, "name"> & FieldProps;

/** Строка под полем: «Ещё N символов» до минимума (когда человек уже начал писать) или «N из M» у предела; иначе `null`. */
function countText(value: unknown, minLength: number | undefined, maxLength: number | undefined): { text: string; over: boolean } | null {
  if (typeof value !== "string") return null;
  const t = ru.app.kit.fields;
  const typed = value.trim().length;
  if (minLength !== undefined && typed > 0 && typed < minLength) return { text: t.charsLeft(minLength - typed), over: false };
  if (maxLength !== undefined && value.length >= Math.ceil(maxLength * 0.8)) return { text: t.counter(value.length, maxLength), over: value.length > maxLength };
  return null;
}

/**
 * Многострочное поле без системного уголка изменения размера: высота растёт по содержимому (field-sizing: content)
 * от трёх строк (min-h-area). Где field-sizing не поддерживается, остаётся фиксированная высота в `rows` (4) строки.
 * У управляемого поля (`value`) под ним появляется счётчик: «Ещё N символов» до `minLength` (только когда человек уже
 * начал писать; сама проверка — у схемы, `minLength` в разметку не попадает) и «N из M» у предела `maxLength`.
 */
export function TextArea({ label, error, id: explicitId, className, rows = 4, minLength, ...rest }: TextAreaProps) {
  const { id, errorId } = useFieldIds(explicitId, error);
  const count = countText(rest.value, minLength, rest.maxLength);
  const countId = count ? `${id}-count` : undefined;
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
        aria-describedby={describedBy(describedBy(rest["aria-describedby"], countId), errorId)}
      />
      {count && (
        <p id={countId} className={cn("text-small tabular-nums", count.over ? "text-danger" : "text-muted")}>
          {count.text}
        </p>
      )}
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
            "flex size-6 shrink-0 items-center justify-center rounded-small border bg-surface text-on-action",
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

/** Вариант выбора в виде карточки: выбранная выделена линией 1 px цвета действия; `description` — вторая строка под подписью: имя радио — только подпись (`aria-labelledby`), описание — только `aria-describedby` (диктор не читает его дважды). Высота не ниже 48 px. Ошибка — у `RadioGroup`. */
export function RadioCard({ label, description, id: explicitId, className, ...rest }: RadioCardProps) {
  const auto = useId();
  const id = explicitId ?? auto;
  const descriptionId = description ? `${id}-description` : undefined;
  const labelId = description ? `${id}-label` : undefined;
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
      <input id={id} type="radio" className={cn("peer sr-only", className)} {...rest} aria-labelledby={rest["aria-labelledby"] ?? labelId} aria-describedby={describedBy(rest["aria-describedby"], descriptionId)} />
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong peer-checked:border-action peer-checked:[&>span]:opacity-100"
      >
        <span className="size-3 rounded-full bg-action opacity-0 radio-mark" />
      </span>
      {description ? (
        <span className="flex min-w-0 flex-col">
          <span id={labelId}>{label}</span>
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
