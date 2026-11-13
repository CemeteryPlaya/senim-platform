// Регистрация сервис-воркера: одна на оба интерфейса (v1 и v2). Тот же файл и тот же scope — повторная регистрация
// безвредна, браузер возвращает существующую.

/** Файл воркера (public/sw.js): офлайн-страница и показ push, без кэша данных. */
export const SERVICE_WORKER_URL = "/sw.js";

/**
 * Область «/» (и v1, и /v2). `updateViaCache: "none"` — браузер всегда проверяет свежую версию sw.js, минуя HTTP-кэш.
 */
export const SERVICE_WORKER_OPTIONS = { scope: "/", updateViaCache: "none" } as const;

/** Что нужно от `navigator` (подмножество Navigator): в тестах подставляется подделка. */
export type ServiceWorkerHost = { serviceWorker?: { register(url: string, options: typeof SERVICE_WORKER_OPTIONS): Promise<unknown> } };

/**
 * Регистрирует /sw.js. Нет поддержки воркеров или регистрация не удалась — тихо ничего: без воркера сайт работает как
 * раньше, при отсутствии сети браузер покажет свою страницу.
 */
export async function registerServiceWorker(host: ServiceWorkerHost): Promise<void> {
  if (!host.serviceWorker) return;
  try {
    await host.serviceWorker.register(SERVICE_WORKER_URL, SERVICE_WORKER_OPTIONS);
  } catch {
    // см. выше
  }
}
