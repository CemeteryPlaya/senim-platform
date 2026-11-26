"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ru } from "@/i18n/ru";
import { InputField, type FieldProps, type LabelHiddenProp } from "./fields";
import { suggestEmail } from "./field-logic";
import { useMountFocus } from "./useMountFocus";

export type EmailFieldProps = FieldProps & LabelHiddenProp & {
  defaultValue?: string;
  autoFocus?: boolean;
  maxLength?: number;
};

/** Пауза в наборе, после которой подсказывается исправление домена. */
export const EMAIL_SUGGEST_PAUSE_MS = 600;

/** Показать исправление адреса, если оно есть, и запомнить адрес, к которому оно показано. Есть исправление — `true`. */
function offerFix(email: string, seen: RefObject<string | null>, show: (hint: string | null) => void): boolean {
  const hint = suggestEmail(email);
  if (hint !== null) seen.current = email;
  show(hint);
  return hint !== null;
}

/**
 * Поле почты: клавиатура с «@», автозаполнение `email`, без автоисправления и заглавной буквы. Если домен похож на
 * частый, но с опечаткой («gmial.com», «mail.ri», «yandex.ry»), под полем — «Возможно, вы имели в виду …?»: нажатие
 * подставляет исправленный адрес и возвращает фокус в поле. Подсказка появляется после паузы в наборе или вставки (когда
 * в домене уже есть точка) и при попытке отправить форму: адрес с опечаткой молча не уходит — первая отправка, если
 * подсказку человек ещё не видел, останавливается и показывает её; повторная без выбора отправляет адрес как есть (это
 * подсказка, не ошибка). При уходе с поля подсказка не появляется: уход — обычно нажатие кнопки, и подсказка, «увиденная»
 * в том же касании, пропустила бы отправку с опечаткой.
 * Место под строку подсказки занято всегда: её появление не сдвигает кнопку под пальцем или курсором. В форму уходит
 * то, что в поле (разбор — схема действия). Клиентский компонент.
 */
export function EmailField({ defaultValue = "", autoFocus, maxLength = 254, ...field }: EmailFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Адрес, к которому подсказка уже показана: с ним отправка не останавливается.
  const seen = useRef<string | null>(null);
  useMountFocus(input, autoFocus);


  // Пауза в наборе: домен с точкой — пора подсказать.
  useEffect(() => {
    if (!(value.split("@")[1] ?? "").includes(".")) return;
    const timer = setTimeout(() => offerFix(value, seen, setSuggestion), EMAIL_SUGGEST_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  // Отправка формы с опечаткой, которую человек ещё не видел, — остановить и показать подсказку. Свой обработчик на
  // форме срабатывает раньше обработчика React у корня: остановленное событие до `useActionForm` не доходит.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const onSubmit = (event: Event) => {
      const email = input.current?.value ?? "";
      if (seen.current === email || !offerFix(email, seen, setSuggestion)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input.current?.scrollIntoView({ block: "center" });
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

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
      after={
        // Живая область есть всегда и занимает строку подсказки заранее: диктор объявит подсказку, раскладка не сдвинется.
        <div aria-live="polite" className="min-h-hint text-body">
          {suggestion && (
            <button
              type="button"
              onClick={() => accept(suggestion)}
              className="flex min-h-control w-fit items-center text-left text-body text-ink underline underline-offset-4 wrap-anywhere"
            >
              {ru.app.kit.fields.emailSuggest(suggestion)}
            </button>
          )}
        </div>
      }
    />
  );
}
