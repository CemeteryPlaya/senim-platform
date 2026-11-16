"use client";

import { useId } from "react";
import { Button } from "./Button";
import { InputField, type FieldProps } from "./fields";

export type CityFieldProps = FieldProps & {
  value: string;
  onChange: (value: string) => void;
  /** Города для подсказки: пока человек набирает, браузер предлагает подходящие; свой город вводится свободно. */
  suggestions: readonly string[];
  maxLength?: number;
  /** Сколько первых городов показать кнопками под пустым полем (на телефоне — одно касание вместо набора); по умолчанию три. */
  quick?: number;
};

/**
 * Поле «Город»: обычный ввод с подсказкой городов по мере набора (`datalist`: слово подставляется по началу, список
 * листается, свой вариант не запрещён) и кнопками частых городов под пустым полем. Заглавная буква сама, без
 * автоисправления; автозаполнение `address-level2`. Значение — строка как есть: проверяет схема действия. Клиентский компонент.
 */
export function CityField({ value, onChange, suggestions, maxLength, quick = 3, ...field }: CityFieldProps) {
  const listId = `${useId()}-cities`;
  return (
    <>
      <InputField
        {...field}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        list={listId}
        maxLength={maxLength}
        autoComplete="address-level2"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        after={
          value.trim() === "" && quick > 0 ? (
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, quick).map((city) => (
                <Button key={city} variant="secondary" size="sm" onClick={() => onChange(city)}>
                  {city}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />
      <datalist id={listId}>
        {suggestions.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>
    </>
  );
}
