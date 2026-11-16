"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { InputField, type FieldProps } from "./fields";
import { instagramName } from "./field-logic";

export type InstagramFieldProps = FieldProps & {
  /** Имя без «@» (как хранится в профиле). */
  defaultValue?: string;
};

/**
 * Поле Instagram: «@» стоит в поле, человек вводит имя или вставляет ссылку на профиль из приложения
 * («https://www.instagram.com/dala.mebel?igsh=…» → «dala.mebel»). Без автоисправления, заглавной буквы и проверки
 * орфографии (iOS не «исправляет» имя). В форму уходит имя без «@»; правила имени проверяет схема. Клиентский компонент.
 */
export function InstagramField({ defaultValue = "", ...field }: InstagramFieldProps) {
  const [value, setValue] = useState(() => instagramName(defaultValue));
  return (
    <InputField
      {...field}
      prefix={ru.app.kit.fields.instagramPrefix}
      value={value}
      onChange={(e) => setValue(instagramName(e.currentTarget.value))}
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
