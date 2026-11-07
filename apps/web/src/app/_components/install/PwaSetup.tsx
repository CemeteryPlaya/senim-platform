"use client";

import { useEffect } from "react";
// Импорт ради побочного эффекта: подписка на beforeinstallprompt с первой загрузки страницы.
import "./install-store";

/**
 * Регистрирует сервис-воркер /sw.js (только офлайн-страница, без кэша данных — см. public/sw.js).
 * updateViaCache: "none" — браузер всегда проверяет свежую версию sw.js, минуя HTTP-кэш.
 */
export function PwaSetup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Без сервис-воркера сайт работает как раньше; при отсутствии сети браузер покажет свою страницу.
    });
  }, []);
  return null;
}
