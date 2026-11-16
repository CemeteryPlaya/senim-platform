"use client";

import { useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { InputField, type FieldProps } from "./fields";
import { suggestEmail } from "./field-logic";
import { useMountFocus } from "./useMountFocus";

export type EmailFieldProps = FieldProps & {
  defaultValue?: string;
  autoFocus?: boolean;
  maxLength?: number;
};

/**
 * Поле почты: клавиатура с «@», автозаполнение `email`, без автоисправления и заглавной буквы. Когда человек уходит с
 * поля, а домен похож на частый, но с опечаткой («gmial.com», «mail.ri», «yandex.ry»), под полем — «Возможно, вы имели в
 * виду …?»: нажатие подставляет исправленный адрес и возвращает фокус в поле. Это подсказка, не ошибка: адрес можно
 * оставить как есть. В форму уходит то, что в поле (разбор — схема действия). Клиентский компонент.
 */
export function EmailField({ defaultValue = "", autoFocus, maxLength = 254, ...field }: EmailFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useMountFocus(input, autoFocus);

  function accept(email: string) {
    const el = input.current;
    setValue(email);
    setSuggestion(null);
    el?.focus();
    // Правка мимо набора: форма узнаёт о ней из события input (снять ошибку поля).
    el?.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return (
    <InputField
      {...field}
      ref={input}
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      maxLength={maxLength}
      value={value}
      onChange={(e) => {
        setValue(e.currentTarget.value);
        setSuggestion(null);
      }}
      onBlur={(e) => setSuggestion(suggestEmail(e.currentTarget.value))}
      after={
        // Живая область есть всегда: диктор объявит подсказку, когда она появится.
        <div aria-live="polite">
          {suggestion && (
            <button
              type="button"
              onClick={() => accept(suggestion)}
              className="inline-flex min-h-control w-fit items-center text-left text-body text-ink underline underline-offset-4 wrap-anywhere"
            >
              {ru.app.kit.fields.emailSuggest(suggestion)}
            </button>
          )}
        </div>
      }
    />
  );
}
