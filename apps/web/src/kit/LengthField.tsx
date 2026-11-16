"use client";

import { ru } from "@/i18n/ru";
import { InputField, type FieldProps } from "./fields";
import { HiddenField } from "./HiddenField";
import { lengthNote, parseLengthCm } from "./length-logic";

export type LengthFieldProps = FieldProps & {
  /** Текст поля как набран («2,4 м», «240»). */
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  enterKeyHint?: "done" | "next" | "send" | "go";
};

/**
 * Поле длины для размеров мебели: «см» стоит в поле, понимает «240», «2,4 м», «2400 мм», «2.4» (`parseLengthCm`); при
 * наборе с другой единицей под полем «= 240 см», по уходу с поля текст приводится к сантиметрам. Цифровая клавиатура с
 * запятой (`decimal`). В форму уходят целые сантиметры (скрытое поле с `name`); текст, который не длина, уходит как есть,
 * и схема скажет у поля, что нужно. Клиентский компонент.
 */
export function LengthField({ value, onChange, name, enterKeyHint, ...field }: LengthFieldProps) {
  const cm = parseLengthCm(value);
  const note = lengthNote(value);
  return (
    <>
      <InputField
        {...field}
        data-field={name}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={() => {
          if (cm !== null) onChange(String(cm));
        }}
        suffix={ru.app.kit.fields.lengthUnit}
        inputMode="decimal"
        enterKeyHint={enterKeyHint}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        after={note !== null ? <p className="text-sub text-muted">{ru.app.kit.fields.lengthAs(note)}</p> : undefined}
      />
      <HiddenField name={name} value={cm === null ? value.trim() : String(cm)} />
    </>
  );
}
