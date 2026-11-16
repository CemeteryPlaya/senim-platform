"use client";

import { useState, type FocusEvent } from "react";
import { ru } from "@/i18n/ru";
import type { FieldProps } from "./fields";
import { checkIban, type IdCheck } from "./id-check";
import { MaskedField } from "./MaskedField";
import { IBAN_MASK } from "./mask-logic";

export type IbanFieldProps = FieldProps & {
  defaultValue?: string;
  autoFocus?: boolean;
  /** Уход с поля: вызывается после своей проверки номера. */
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
};

const t = ru.app.kit.fields;

function problemOf(check: IdCheck): string | null {
  if (check === "short") return t.ibanShort;
  if (check === "invalid") return t.ibanInvalid;
  return null;
}

/**
 * Поле IBAN казахстанского банка: заглавные буквы и цифры, группы по 4 («KZ86 125K ZT50 0410 0100») при наборе и
 * вставке (строчные из банковского приложения становятся заглавными), не больше 20 знаков. Номер проверяется до
 * отправки — при 20 знаках и при уходе с поля (та же `parseKzIban`, что у схемы); ошибка у поля, при правке снимается.
 * Название банка не показывается: надёжного справочника кодов банков в коде нет. В форму уходят 20 знаков без пробелов.
 * Клиентский компонент.
 */
export function IbanField({ error, onBlur, ...field }: IbanFieldProps) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <MaskedField
      {...field}
      mask={IBAN_MASK}
      error={error ?? problem ?? undefined}
      onValueChange={(sig) => setProblem(problemOf(checkIban(sig, false)))}
      onBlur={(e) => {
        setProblem(problemOf(checkIban(IBAN_MASK.keep(e.currentTarget.value), true)));
        onBlur?.(e);
      }}
      inputMode="text"
      autoComplete="off"
      autoCapitalize="characters"
      className="tabular-nums"
    />
  );
}
