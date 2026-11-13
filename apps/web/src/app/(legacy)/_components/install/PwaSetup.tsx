"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/features/pwa/register";
// Импорт ради побочного эффекта: подписка на beforeinstallprompt с первой загрузки страницы.
import "./install-store";

/**
 * Регистрирует сервис-воркер /sw.js (только офлайн-страница, без кэша данных — см. public/sw.js).
 * Сама регистрация — в src/features/pwa (общая с v2).
 */
export function PwaSetup() {
  useEffect(() => {
    void registerServiceWorker(navigator);
  }, []);
  return null;
}
