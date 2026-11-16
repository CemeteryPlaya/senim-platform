"use client";

import { useState, type FocusEvent } from "react";
import { ru } from "@/i18n/ru";
import { blursToSubmit } from "./field-logic";
import type { FieldProps } from "./fields";
import { checkIdentity, type IdCheck, type IdentityKind } from "./id-check";
import { MaskedField } from "./MaskedField";
import { IIN_MASK } from "./mask-logic";

export type IinFieldProps = FieldProps & {
  /** ИИН человека (по умолчанию) или БИН организации: разные правила проверки и тексты ошибки. */
  kind?: IdentityKind;
  defaultValue?: string;
  autoFocus?: boolean;
  /** После каждой правки: цифры номера без пробелов. */
  onValueChange?: (digits: string) => void;
  /** Уход с поля: вызывается после своей проверки номера. */
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
};

const t = ru.app.kit.fields;

/** Текст ошибки по итогу проверки; `null` — ошибки нет (номер верный или ещё набирается). */
function problemOf(kind: IdentityKind, check: IdCheck): string | null {
  if (check === "short") return kind === "iin" ? t.iinShort : t.binShort;
  if (check === "invalid") return kind === "iin" ? t.iinInvalid : t.binInvalid;
  return null;
}

/**
 * Поле ИИН или БИН: только цифры, не больше 12, показ группами «870304 300 612». Номер проверяется до отправки — сразу
 * после 12-й цифры и при уходе с поля, кроме ухода на кнопку отправки (`blursToSubmit`; те же правила, что у схем identity: контрольная цифра, дата, тип); ошибка у поля.
 * Пока человек правит номер, прежняя ошибка снимается. Ошибка с сервера (`error`) важнее своей. В форму уходят цифры без
 * пробелов. После сохранения номер не показывается (только 4 последние цифры — дело экрана). Клиентский компонент.
 */
export function IinField({ kind = "iin", error, onBlur, onValueChange, ...field }: IinFieldProps) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <MaskedField
      {...field}
      mask={IIN_MASK}
      error={error ?? problem ?? undefined}
      onValueChange={(digits) => {
        setProblem(problemOf(kind, checkIdentity(kind, digits, false)));
        onValueChange?.(digits);
      }}
      onBlur={(e) => {
        if (!blursToSubmit(e.currentTarget, e.relatedTarget)) setProblem(problemOf(kind, checkIdentity(kind, IIN_MASK.keep(e.currentTarget.value), true)));
        onBlur?.(e);
      }}
      inputMode="numeric"
      autoComplete="off"
      className="tabular-nums"
    />
  );
}
