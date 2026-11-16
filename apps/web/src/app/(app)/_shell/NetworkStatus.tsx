"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { ru } from "@/i18n/ru";
import { Notice, toast } from "@/kit";
import { shouldRefreshOnReconnect, shouldRefreshOnReturn, type ReturnState } from "./connection";

const t = ru.app.shell.offline;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Есть ли сеть, по мнению браузера (`navigator.onLine` и события online/offline); на сервере — есть. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Связь и свежесть экрана в оболочке (аудит поведения B-5, B-7):
 * - нет сети — плашка «Нет связи с интернетом» сверху области содержимого (прилипает при прокрутке, `aria-live` через
 *   `role="alert"`); главные кнопки остаются доступными — сбой отправки они покажут сами (подпись, окно подтверждения);
 * - связь вернулась — экран перечитывается (`router.refresh()`), тост «Связь восстановлена»;
 * - вкладка или установленное приложение снова видны после паузы не меньше 30 с — экран перечитывается тихо, не чаще раза
 *   в 30 с (`shouldRefreshOnReturn`); возврат из bfcache (`pageshow` с `persisted`) — так же.
 * `router.refresh()` перечитывает серверные части экрана и не сбрасывает состояние клиентских (введённое в формах остаётся).
 */
export function NetworkStatus() {
  const router = useRouter();
  const online = useOnline();
  const wasOnline = useRef(true);
  const state = useRef<ReturnState>({ hiddenAt: null, refreshedAt: 0 });

  useEffect(() => {
    state.current.refreshedAt = Date.now();
  }, []);

  useEffect(() => {
    if (shouldRefreshOnReconnect(wasOnline.current, online)) {
      state.current.refreshedAt = Date.now();
      router.refresh();
      toast(t.back);
    }
    wasOnline.current = online;
  }, [online, router]);

  useEffect(() => {
    const refreshIfStale = () => {
      const now = Date.now();
      if (shouldRefreshOnReturn(state.current, now, navigator.onLine)) {
        state.current.refreshedAt = now;
        router.refresh();
      }
      state.current.hiddenAt = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") state.current.hiddenAt = Date.now();
      else refreshIfStale();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // Страница вернулась из bfcache («Назад» после ухода на другой сайт): считаем, что она была скрыта с ухода.
      if (event.persisted && state.current.hiddenAt === null) state.current.hiddenAt = state.current.refreshedAt;
      if (event.persisted) refreshIfStale();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  if (online) return null;
  return (
    <div data-offline-banner className="sticky-notice mb-stack-section">
      <Notice tone="warn" title={t.title} live>
        {t.body}
      </Notice>
    </div>
  );
}
