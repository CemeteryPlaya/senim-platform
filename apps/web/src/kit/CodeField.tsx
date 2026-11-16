"use client";

import { useRef, type ChangeEvent } from "react";
import { codeAutoSubmit } from "./field-logic";
import { TextField, type FieldProps } from "./fields";
import { useMountFocus } from "./useMountFocus";

export type CodeFieldProps = FieldProps & {
  /** Сколько цифр в коде (по умолчанию 6). */
  length?: number;
  defaultValue?: string;
  /** Фокус в поле при появлении (шаг кода). */
  autoFocus?: boolean;
  /**
   * Отправить форму поля самому, когда набрана (или подставлена из SMS) последняя цифра: `requestSubmit()` формы, как
   * нажатие кнопки. Один раз на код: код с ошибкой не уходит снова, пока его не изменили (`codeAutoSubmit`); кнопка
   * отправки остаётся для повтора.
   */
  autoSubmit?: boolean;
};

/**
 * Поле кода из сообщения: одно поле на всё число, а не по клетке на цифру (вставка и подстановка кода с телефона
 * работают, диктор читает поле целиком). Цифровая клавиатура, `one-time-code`, цифры одной ширины с разрядкой
 * (`tabular-nums`, `tracking-code`). Предел ввода — длина × 2, а не длина: вставка «123 456» не теряет цифру;
 * пробелы и прочее убирает схема действия (`digitsOnly` из `@/platform/digits` в zod `.transform`), она же проверяет
 * длину. Ширина — под код (`max-w-code`, 10 rem), а не вся ширина формы; подпись и ошибка остаются у поля.
 * WebOTP (`navigator.credentials.get({ otp })`) не подключён: он требует последней строки SMS вида «@домен #код», а текст
 * SMS задаёт identity. Клиентский компонент.
 */
export function CodeField({ length = 6, autoFocus, autoSubmit = false, ...field }: CodeFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const sent = useRef<string | null>(null);
  useMountFocus(input, autoFocus);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    if (!autoSubmit) return;
    const decision = codeAutoSubmit(event.currentTarget.value, length, sent.current);
    sent.current = decision.sent;
    if (decision.submit) event.currentTarget.form?.requestSubmit();
  }

  return (
    <TextField
      {...field}
      ref={input}
      onChange={onChange}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={length * 2}
      enterKeyHint="done"
      spellCheck={false}
      className="max-w-code tracking-code tabular-nums"
    />
  );
}
