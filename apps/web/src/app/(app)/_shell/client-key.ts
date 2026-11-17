"use client";

import { useCallback, useRef } from "react";

export type ClientKey = {
  /** Ключ для отправки этого содержимого: то же, что в прошлой неудачной попытке, — тот же ключ; иначе — новый. */
  keyFor: (content: unknown) => string;
  /** Отправка удалась: следующая — новая запись, новый ключ. */
  done: () => void;
};

/**
 * UUID v4 для ключей повтора и локальных id загрузок. `crypto.randomUUID` есть только в защищённом контексте (https,
 * localhost): на телефоне, открывшем стенд по адресу локальной сети по http, его нет — тогда UUID собирается из
 * `crypto.getRandomValues` (он есть везде).
 */
export function randomKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Ключ повтора создающей формы (первый шаг заявки, отчёт о ходе работ, работа портфолио, сообщение): уходит скрытым полем
 * `clientKey`. Повтор той же отправки (обрыв связи после записи, двойное нажатие) — тот же ключ, и модуль отдаёт уже
 * созданную запись. Ключ привязан к содержимому: человек поправил форму — это новая отправка с новым ключом, иначе сервер
 * молча отдал бы прежнюю запись, а правка пропала бы. После успеха — `done()`.
 */
export function useClientKey(): ClientKey {
  const last = useRef<{ key: string; content: string } | null>(null);
  const keyFor = useCallback((content: unknown) => {
    const serialized = JSON.stringify(content);
    if (last.current?.content === serialized) return last.current.key;
    last.current = { key: randomKey(), content: serialized };
    return last.current.key;
  }, []);
  const done = useCallback(() => {
    last.current = null;
  }, []);
  return { keyFor, done };
}
