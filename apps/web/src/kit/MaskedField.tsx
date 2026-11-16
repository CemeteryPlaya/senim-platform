"use client";

import { useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type ComponentProps, type ReactNode } from "react";
import { InputField } from "./fields";
import { HiddenField } from "./HiddenField";
import { applyEdit, fromRaw, pasteInto, type Edited, type Mask } from "./mask-logic";
import { useMountFocus } from "./useMountFocus";

export type MaskedFieldProps = Omit<ComponentProps<"input">, "name" | "value" | "defaultValue" | "onChange" | "prefix" | "children"> & {
  label: string;
  name: string;
  error?: string;
  mask: Mask;
  /** Фокус в поле при появлении (шаг входа, открытый по ссылке). */
  autoFocus?: boolean;
  /** Начальное значение в любом виде («+7 700 …», «KZ86 125k…»): разбирается маской. */
  defaultValue?: string;
  /** Значимые символы → значение скрытого поля формы (по умолчанию — сами символы). */
  toValue?: (sig: string) => string;
  /** После каждой правки: значимые символы (цифры, буквы IBAN). */
  onValueChange?: (sig: string) => void;
  prefix?: string;
  suffix?: string;
  after?: ReactNode;
};

/**
 * Поле с маской (внутреннее для kit: на нём `PhoneField`, `MoneyField`, `IinField`, `IbanField`). Видимое поле показывает
 * значение с разделителями и держит курсор на месте при правке в середине (`applyEdit`); имя и значение для формы — у
 * скрытого поля рядом (то, что ждёт схема действия), видимое несёт `data-field` с тем же именем. Вставка, автозаполнение
 * и удаление проходят через ту же маску; диктор читает значение поля как есть.
 */
export function MaskedField({ name, mask, defaultValue = "", toValue = (sig) => sig, onValueChange, autoFocus, ...field }: MaskedFieldProps) {
  const [state, setState] = useState(() => fromRaw(mask, defaultValue));
  const input = useRef<HTMLInputElement>(null);
  useMountFocus(input, autoFocus);
  const caret = useRef<number | null>(null);

  // Курсор — после того, как React записал новый показ в поле (запись значения уводит курсор в конец).
  useLayoutEffect(() => {
    const el = input.current;
    if (el === null || caret.current === null) return;
    if (document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const apply = (next: Edited) => {
    caret.current = next.caret;
    setState({ shown: next.shown, value: next.value });
    if (next.value !== state.value) onValueChange?.(next.value);
  };

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const el = event.currentTarget;
    const native = event.nativeEvent as Partial<InputEvent>;
    const caretAt = el.selectionStart ?? el.value.length;
    apply(applyEdit(mask, { prev: state.shown, raw: el.value, caret: caretAt, inputType: native.inputType, data: native.data }));
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const el = event.currentTarget;
    const start = el.selectionStart ?? state.shown.length;
    const end = el.selectionEnd ?? start;
    const next = pasteInto(mask, state.shown, start, end, event.clipboardData.getData("text"));
    if (next === null) return;
    event.preventDefault();
    apply(next);
    // Вставка мимо браузера не даёт события input: форма узнаёт о правке (снять ошибку поля) из этого события.
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return (
    <>
      <InputField
        {...field}
        ref={input}
        data-field={name}
        value={state.shown}
        onChange={onChange}
        onPaste={onPaste}
        autoCorrect="off"
        spellCheck={false}
      />
      <HiddenField name={name} value={toValue(state.value)} />
    </>
  );
}
