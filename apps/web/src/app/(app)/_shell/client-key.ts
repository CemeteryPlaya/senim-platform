"use client";

import { useCallback, useState } from "react";

export type ClientKey = { key: string; renew: () => void };

/**
 * Ключ повтора создающей формы (первый шаг заявки, сообщение, отчёт о ходе работ, работа портфолио): заводится один раз при
 * открытии формы и уходит скрытым полем `clientKey`. Повтор той же отправки (обрыв связи после записи, двойное нажатие) —
 * тот же ключ: модуль отдаёт уже созданную запись. После успешной отправки форма вызывает `renew()` — следующая запись новая.
 */
export function useClientKey(): ClientKey {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const renew = useCallback(() => setKey(crypto.randomUUID()), []);
  return { key, renew };
}
