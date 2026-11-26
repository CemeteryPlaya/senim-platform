"use client";

import { ru } from "@/i18n/ru";
import type { FieldProps, LabelHiddenProp } from "./fields";
import { MaskedField } from "./MaskedField";
import { PHONE_MASK, phoneValue } from "./mask-logic";

export type PhoneFieldProps = FieldProps & LabelHiddenProp & {
  /** Номер в любом виде («+77001234567», «8 700 …»). */
  defaultValue?: string;
  /** Фокус в поле при появлении (шаг номера при входе). */
  autoFocus?: boolean;
};

const t = ru.app.kit.fields;

/**
 * Поле мобильного номера РК. «+7» стоит в поле всегда и не стирается; номер раскладывается при наборе («700 123 45 67»),
 * курсор при правке в середине остаётся на месте. Набор и вставка «8 700 …», «+7 (700) …», «87001234567», автозаполнение
 * «+77001234567» приводятся к 10 цифрам (`PHONE_MASK`). Клавиатура набора номера, автозаполнение `tel`. В форму уходит
 * `+7XXXXXXXXXX` (неполный номер — как набран; полноту и формат проверяет схема действия). Клиентский компонент.
 */
export function PhoneField({ defaultValue, autoFocus, ...field }: PhoneFieldProps) {
  return (
    <MaskedField
      {...field}
      mask={PHONE_MASK}
      toValue={phoneValue}
      defaultValue={defaultValue}
      autoFocus={autoFocus}
      prefix={t.phonePrefix}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={t.phonePlaceholder}
    />
  );
}
