"use client";

import { useCallback, useState } from "react";

export type ClientKey = { key: string; renew: () => void };

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
 * Ключ повтора создающей формы (первый шаг заявки, сообщение, отчёт о ходе работ, работа портфолио): заводится один раз при
 * открытии формы и уходит скрытым полем `clientKey`. Повтор той же отправки (обрыв связи после записи, двойное нажатие) —
 * тот же ключ: модуль отдаёт уже созданную запись. После успешной отправки форма вызывает `renew()` — следующая запись новая.
 */
export function useClientKey(): ClientKey {
  const [key, setKey] = useState(randomKey);
  const renew = useCallback(() => setKey(randomKey()), []);
  return { key, renew };
}
