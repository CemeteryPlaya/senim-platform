import { TextField, type FieldProps } from "./fields";

export type CodeFieldProps = FieldProps & {
  /** Сколько цифр в коде (по умолчанию 6). */
  length?: number;
  defaultValue?: string;
};

/**
 * Поле кода из сообщения: одно поле на всё число, а не по клетке на цифру (вставка и подстановка кода с телефона
 * работают, диктор читает поле целиком). Цифровая клавиатура, `one-time-code`, цифры одной ширины с разрядкой
 * (`tabular-nums`, `tracking-code`). Серверный компонент.
 */
export function CodeField({ length = 6, ...field }: CodeFieldProps) {
  return (
    <TextField
      {...field}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={length}
      pattern={`[0-9]{${length}}`}
      enterKeyHint="done"
      spellCheck={false}
      className="tracking-code tabular-nums"
    />
  );
}
