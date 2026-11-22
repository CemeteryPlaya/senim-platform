"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { ru } from "@/i18n/ru";
import { Button } from "./Button";
import { cn } from "./cn";
import { InputField, type FieldProps } from "./fields";
import { Popover } from "./Popover";

export type CityFieldProps = FieldProps & {
  value: string;
  onChange: (value: string) => void;
  /** Города для подсказки: пока человек набирает, браузер предлагает подходящие; свой город вводится свободно. */
  suggestions: readonly string[];
  maxLength?: number;
  /** Сколько первых городов показать кнопками под пустым полем (на телефоне — одно касание вместо набора); по умолчанию три. */
  quick?: number;
};

const t = ru.app.kit.cityList;

/**
 * Поле «Город»: обычный ввод с подсказкой городов по мере набора (`datalist`: слово подставляется по началу, список
 * листается, свой вариант не запрещён), кнопкой со стрелкой в поле — она открывает весь список (`datalist` на телефоне
 * касанием не открывается) — и кнопками частых городов под пустым полем. Заглавная буква сама, без автоисправления;
 * автозаполнение `address-level2`. Значение — строка как есть: проверяет схема действия. Клиентский компонент.
 */
export function CityField({ value, onChange, suggestions, maxLength, quick = 3, ...field }: CityFieldProps) {
  const listId = `${useId()}-cities`;
  const [open, setOpen] = useState(false);
  const pick = (city: string) => {
    onChange(city);
    setOpen(false);
  };
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
        trailing={
          <Popover
            title={t.title}
            material="glass"
            open={open}
            onOpenChange={setOpen}
            trigger={
              <button
                type="button"
                aria-label={t.open}
                className="inline-flex size-control min-h-control cursor-pointer items-center justify-center rounded-control text-muted pressable hover:text-ink"
              >
                <ChevronDown aria-hidden className="size-5" />
              </button>
            }
          >
            <ul className="mt-2 flex flex-col">
              {suggestions.map((city) => (
                <li key={city}>
                  <button
                    type="button"
                    aria-current={city === value ? "true" : undefined}
                    onClick={() => pick(city)}
                    className={cn(
                      "flex min-h-control w-full cursor-pointer items-center rounded-control px-3 text-left text-body text-ink pressable hover:bg-fill",
                      city === value && "font-semibold",
                    )}
                  >
                    {city}
                  </button>
                </li>
              ))}
            </ul>
          </Popover>
        }
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
