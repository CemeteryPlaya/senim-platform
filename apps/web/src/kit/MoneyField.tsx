"use client";

import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { kztToTiyn } from "@/modules/payments/client";
import type { FieldProps } from "./fields";
import { MaskedField } from "./MaskedField";
import { MONEY_MASK, tiynOfDigits } from "./money-logic";

export type MoneyFieldProps = FieldProps & {
  /** Начальная сумма в тиынах (целые тенге; тиыны ниже тенге отбрасываются). */
  defaultTiyn?: bigint | null;
  /**
   * После каждой правки: сумма в тиынах — уже в допустимых пределах схем (1 ₸ … `MAX_PRICE_KZT`), экран может сразу
   * считать `computeDealMoney`; `null` — поле пустое, ноль или сумма выше потолка (расчёта нет).
   */
  onValueChange?: (tiyn: bigint | null) => void;
  /** Строка под полем: «Вы получите …», «К оплате с защитой сделки (2%) …» — считает экран. */
  under?: ReactNode;
  enterKeyHint?: "done" | "next" | "send" | "go";
};


/**
 * Поле суммы в целых тенге. Разряды раскладываются при наборе («1 200 000»), «₸» стоит в поле, буквы, точка и запятая
 * не вводятся; вставка «1 200 000 ₸», «1,2 млн», «1.2 млн», «1.200.000» даёт сумму (`parseMoneyText`). Цифровая
 * клавиатура, без автозаполнения. В форму уходят цифры целых тенге без пробелов — то, что ждут схемы действий (тиыны
 * считает сервер); экран получает сумму в тиынах (`onValueChange`). Клиентский компонент.
 */
export function MoneyField({ defaultTiyn, onValueChange, under, enterKeyHint, ...field }: MoneyFieldProps) {
  return (
    <MaskedField
      {...field}
      mask={MONEY_MASK}
      defaultValue={defaultTiyn == null ? "" : (defaultTiyn / 100n).toString()}
      onValueChange={onValueChange && ((digits) => onValueChange(tiynOfDigits(digits, kztToTiyn)))}
      suffix={ru.app.kit.fields.currency}
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint={enterKeyHint}
      after={under}
      className="tabular-nums"
    />
  );
}
