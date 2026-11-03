"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { focusFirstInvalid } from "./focus";

/**
 * Фокус на первое неверное поле после неудачной отправки. focusInvalid() вызывают вместе с записью ошибок
 * в состояние: фокус ставится после отрисовки, когда у полей уже есть aria-invalid и текст ошибки.
 * Каждый вызов — новая попытка: та же ошибка второй раз снова переводит фокус.
 */
export function useFocusInvalid<T extends HTMLElement = HTMLFormElement>() {
  const ref = useRef<T>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt > 0 && ref.current) focusFirstInvalid(ref.current);
  }, [attempt]);
  const focusInvalid = useCallback(() => setAttempt((n) => n + 1), []);
  return { ref, focusInvalid };
}
