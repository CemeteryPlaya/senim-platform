"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { InputField, type FieldProps } from "./fields";
import { instagramEdit, instagramName } from "./field-logic";

export type InstagramFieldProps = FieldProps & {
  /** Имя без «@» (как хранится в профиле). */
  defaultValue?: string;
};

/**
 * Поле Instagram: «@» стоит в поле, человек вводит имя или вставляет ссылку на профиль из приложения
 * («https://www.instagram.com/dala.mebel?igsh=…» → «dala.mebel»). Ссылка на публикацию («…/p/…», «…/reel/…») имени не
 * содержит: поле остаётся пустым, у поля — «нужна ссылка на профиль». «@» и пробелы убираются без прыжка курсора в
 * конец. Без автоисправления, заглавной буквы и проверки орфографии (iOS не «исправляет» имя). В форму уходит имя без
 * «@»; правила имени проверяет схема; ошибка сервера (`error`) важнее своей. Клиентский компонент.
 */
export function InstagramField({ defaultValue = "", error, ...field }: InstagramFieldProps) {
  const [value, setValue] = useState(() => instagramName(defaultValue));
  const [post, setPost] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  // Курсор — после того, как React записал очищенное значение (запись уводит курсор в конец).
  useLayoutEffect(() => {
    const el = input.current;
    if (el === null || caret.current === null) return;
    if (document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <InputField
      {...field}
      ref={input}
      error={error ?? (post ? ru.app.kit.fields.instagramPost : undefined)}
      prefix={ru.app.kit.fields.instagramPrefix}
      value={value}
      onChange={(e) => {
        const el = e.currentTarget;
        const next = instagramEdit(el.value, el.selectionStart ?? el.value.length);
        caret.current = next.caret;
        setValue(next.value);
        setPost(next.post);
      }}
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
