"use client";

import { useEffect, useState } from "react";

// Черновик длинной формы в sessionStorage вкладки: уход и возвращение («Назад», перезагрузка, другая вкладка приложения)
// не стирают введённое; после успешной отправки черновик забывается. Хранилище может быть недоступно (приватный режим,
// запрет сайта) — тогда форма работает как раньше, без черновика.

const PREFIX = "senim.draft";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Ключ черновика: форма (`offer`) и объект (id заявки). */
export const draftKey = (form: string, id: string): string => `${PREFIX}:${form}:${id}`;

/** Сохранённое поверх пустого: только известные ключи и только строки (чужое и испорченное отбрасывается). */
export function mergeDraft<T extends Record<string, string>>(empty: T, saved: unknown): T {
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return empty;
  const out: Record<string, string> = { ...empty };
  for (const [key, value] of Object.entries(saved)) if (key in empty && typeof value === "string") out[key] = value;
  return out as T;
}

/** Что введено: хоть одно поле не такое, как в пустой форме. */
export const isFilled = <T extends Record<string, string>>(values: T, empty: T): boolean => Object.keys(empty).some((key) => values[key] !== empty[key]);

export type FormDraft<T extends Record<string, string>> = {
  values: T;
  /** Растёт, когда черновик подставлен после открытия экрана: поля с собственным начальным значением пересоздаются по нему. */
  restored: number;
  set: (patch: Partial<T>) => void;
  /** Забыть черновик (после успешной отправки). */
  clear: () => void;
};

/**
 * Черновик формы: значения полей по ключу `draftKey(...)`. Сохранённое подставляется после открытия экрана в браузере (на
 * сервере хранилища нет — иначе разметка разошлась бы при гидратации); каждая правка пишется сразу, пустая форма
 * черновика не оставляет.
 */
export function useFormDraft<T extends Record<string, string>>(key: string, empty: T): FormDraft<T> {
  const [values, setValues] = useState(empty);
  const [restored, setRestored] = useState(0);

  useEffect(() => {
    let saved: unknown = null;
    try {
      const raw = storage()?.getItem(key);
      saved = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      saved = null;
    }
    if (saved === null) return;
    // Восстановление после монтирования: на сервере sessionStorage нет.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues(mergeDraft(empty, saved));
    setRestored((n) => n + 1);
    // Ключ — один на экран; пустая форма не меняется между проходами.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = (patch: Partial<T>) => {
    const next = { ...values, ...patch };
    setValues(next);
    try {
      if (isFilled(next, empty)) storage()?.setItem(key, JSON.stringify(next));
      else storage()?.removeItem(key);
    } catch {
      // Нет места или хранилище запрещено: введённое просто не переживёт уход.
    }
  };

  const clear = () => {
    try {
      storage()?.removeItem(key);
    } catch {
      // Нечего забывать.
    }
    setValues(empty);
    setRestored((n) => n + 1);
  };

  return { values, restored, set, clear };
}
