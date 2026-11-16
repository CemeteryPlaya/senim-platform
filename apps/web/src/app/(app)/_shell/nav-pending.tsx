"use client";

import { useLinkStatus } from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * Какой пункт навигации сейчас «в пути» после очередного сообщения ссылки (чистая функция). Начат переход — этот пункт;
 * закончен — снять, только если в пути был именно он (переход на другой пункт уже начат и не должен сброситься).
 */
export function nextPending(current: string | null, href: string, pending: boolean): string | null {
  if (pending) return href;
  return current === href ? null : current;
}

/** Выбранный пункт на экране: тот, куда человек уже нажал (переход идёт), иначе — текущий адрес. */
export function shownHref(pending: string | null, current: string | undefined): string | undefined {
  return pending ?? current;
}

/**
 * Пункт навигации, по которому начат и ещё не закончен переход (`useLinkStatus` в каждой ссылке), — чтобы «линза» вкладки
 * переехала в момент касания, а не после ответа сервера (аудит поведения B-4). Ссылка, уже загруженная заранее, ожидания
 * не даёт: переход мгновенный, и линзу переносит сам адрес.
 */
export function usePendingHref(): readonly [string | null, (href: string, pending: boolean) => void] {
  const [pending, setPending] = useState<string | null>(null);
  const report = useCallback((href: string, now: boolean) => setPending((current) => nextPending(current, href, now)), []);
  return [pending, report] as const;
}

/** Сообщает оболочке, начат ли переход по ссылке-родителю (`useLinkStatus` работает только внутри `Link`). Ничего не рисует. */
export function LinkPendingReporter({ href, onChange }: { href: string; onChange: (href: string, pending: boolean) => void }) {
  const { pending } = useLinkStatus();
  useEffect(() => {
    onChange(href, pending);
  }, [href, pending, onChange]);
  return null;
}
