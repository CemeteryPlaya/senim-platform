"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { WizardScreen } from "@/modules/requests/client";

// Несохранённый ввод шага мастера в sessionStorage вкладки: «Назад» и перезагрузка не теряют то, что человек ввёл, но
// ещё не отправил «Дальше». Ключ — `<черновик>:<шаг>`; до черновика — метка сессии мастера (`new-<время>`), заведённая
// один раз на вкладку. Хранилище может быть недоступно (приватный режим, запрет сайта) — тогда всё работает без него.

const PREFIX = "senim.request-wizard";
const SESSION = `${PREFIX}.session`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Метка сессии мастера для ещё не созданного черновика. */
function sessionMarker(): string {
  const s = storage();
  try {
    const existing = s?.getItem(SESSION);
    if (existing) return existing;
    const marker = `new-${Date.now().toString(36)}`;
    s?.setItem(SESSION, marker);
    return marker;
  } catch {
    return "new";
  }
}

/** Ключ ввода шага: `<префикс>:<черновик или метка сессии>:<шаг>`. */
export function memoryKey(draftId: string | null, screen: WizardScreen): string {
  return `${PREFIX}:${draftId ?? sessionMarker()}:${screen}`;
}

function read(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Нет места или хранилище запрещено: ввод просто не переживёт «Назад».
  }
}

/** Забыть ввод одного шага (после успешной проверки — его сохраняет сервер). */
export function forgetStep(draftId: string | null, screen: WizardScreen): void {
  try {
    storage()?.removeItem(memoryKey(draftId, screen));
  } catch {
    // Нечего забывать.
  }
}

/** Забыть ввод всех шагов черновика (после отправки заявки). */
export function forgetDraft(draftId: string): void {
  const s = storage();
  try {
    if (!s) return;
    const own = `${PREFIX}:${draftId}:`;
    for (const key of Object.keys(s)) if (key.startsWith(own)) s.removeItem(key);
  } catch {
    // Нечего забывать.
  }
}

/** Сохранённое значение поверх начального: только известные ключи и того же типа (чужое и испорченное отбрасывается). */
export function mergeSaved<T extends Record<string, unknown>>(initial: T, saved: unknown): T {
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return initial;
  const out: Record<string, unknown> = { ...initial };
  for (const [key, value] of Object.entries(saved)) {
    if (!(key in initial)) continue;
    const base = initial[key];
    // null и объект взаимозаменяемы (точка адреса: есть или нет); остальное — того же типа.
    const objectOrNull = (v: unknown) => v === null || (typeof v === "object" && !Array.isArray(v));
    if (objectOrNull(base) ? objectOrNull(value) : typeof base === typeof value) out[key] = value;
  }
  return out as T;
}

/**
 * Состояние шага, которое переживает «Назад» и перезагрузку: после открытия шага (в браузере, не на сервере — иначе
 * разметка разошлась бы при гидратации) подставляется сохранённое, каждое изменение пишется в sessionStorage.
 */
export function useStepMemory<T extends Record<string, unknown>>(
  draftId: string | null,
  screen: WizardScreen,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial);
  const key = useRef<string | null>(null);
  useEffect(() => {
    key.current = memoryKey(draftId, screen);
    const saved = read(key.current);
    // Восстановление после монтирования: на сервере sessionStorage нет.
    if (saved !== null) setValue((current) => mergeSaved(current, saved));
  }, [draftId, screen]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      // Первый проход — начальное значение: не затирать им сохранённое до восстановления.
      first.current = false;
      return;
    }
    if (key.current) write(key.current, value);
  }, [value]);
  return [value, setValue];
}
