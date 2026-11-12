import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Открыто ли окно: управляемо (`open` задан снаружи) или само по себе (открывает триггер).
 * Внутренний помощник окон kit, наружу из `@/kit` не выходит.
 */
export function useOpenState(open: boolean | undefined, onOpenChange?: (open: boolean) => void) {
  const [inner, setInner] = useState(false);
  const controlled = open !== undefined;
  const set = useCallback(
    (next: boolean) => {
      if (!controlled) setInner(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  return [controlled ? open : inner, set] as const;
}

/**
 * Окно без описания: Radix ждёт `Description` и предупреждает в консоли, если его нет и `aria-describedby`
 * не снят явно. С описанием ничего не передаём — Radix сам связывает его с окном.
 */
export function withoutDescription(description: string | undefined): { "aria-describedby"?: undefined } {
  return description ? {} : { "aria-describedby": undefined };
}

/**
 * Возврат фокуса для окна без триггера (открыто программно). С триггером Radix сам возвращает фокус на него;
 * без триггера — некуда, и фокус уходит на `<body>`. Поэтому в момент открытия запоминаем элемент в фокусе
 * (layout-эффект идёт раньше, чем FocusScope переводит фокус внутрь окна) и возвращаем его при закрытии.
 * Результат — обработчик `onCloseAutoFocus` для `Content`.
 */
export function useReturnFocus(open: boolean, enabled: boolean) {
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && enabled && document.activeElement instanceof HTMLElement) returnTo.current = document.activeElement;
  }, [open, enabled]);
  return useCallback(
    (event: Event) => {
      if (!enabled) return;
      const target = returnTo.current;
      returnTo.current = null;
      if (target?.isConnected) {
        event.preventDefault();
        target.focus();
      }
    },
    [enabled],
  );
}
