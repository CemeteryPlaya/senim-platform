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
        target.focus({ preventScroll: true });
      }
    },
    [enabled],
  );
}

/** Действие подтверждения: `false` (или промис с `false`) — окно остаётся открытым. */
export type ConfirmAction = () => void | boolean | Promise<void | boolean>;

export type ConfirmRunner = {
  /** Идёт ли действие: пока да, окно не закрывается и повторный запуск игнорируется. */
  readonly running: boolean;
  /** `close` — закрыть окно при успехе; передаётся при запуске, чтобы был свежим. */
  run(action: ConfirmAction, close: () => void): Promise<void>;
};

/**
 * «Запуск → ожидание → результат» для ConfirmDialog, без React — чтобы проверить юнит-тестом.
 * - Повторный `run`, пока идёт предыдущий, ничего не делает (двойной клик не даёт двойного эффекта).
 * - Успех закрывает окно; `false` — не закрывает.
 * - Исключение или отклонённый промис: окно остаётся открытым, ошибка уходит в `onError` и наружу не идёт
 *   (иначе — `unhandledrejection` из обработчика клика). Показать ошибку пользователю — дело самого действия.
 */
export function createConfirmRunner(deps: {
  setPending: (pending: boolean) => void;
  onError: (error: unknown) => void;
}): ConfirmRunner {
  let running = false;
  return {
    get running() {
      return running;
    },
    async run(action, close) {
      if (running) return;
      running = true;
      deps.setPending(true);
      let success = false;
      try {
        success = (await action()) !== false;
      } catch (error) {
        deps.onError(error);
      } finally {
        running = false;
        deps.setPending(false);
      }
      if (success) close();
    },
  };
}
