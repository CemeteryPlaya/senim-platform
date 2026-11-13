"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/features/pwa/register";

/**
 * Регистрирует тот же сервис-воркер /sw.js, что и v1 (офлайн-страница и показ push; без него push из v2 не работает).
 * Файл и область («/») те же, а v1 и v2 — разные документы: на одной странице регистрация одна, повторная
 * регистрация того же воркера при переходе между интерфейсами безвредна (браузер возвращает существующую).
 * Кнопки «Установить приложение» в v2 нет, поэтому подписки на beforeinstallprompt здесь тоже нет.
 */
export function PwaSetup() {
  useEffect(() => {
    void registerServiceWorker(navigator);
  }, []);
  return null;
}
