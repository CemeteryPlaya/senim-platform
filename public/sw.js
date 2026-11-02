/*
 * Сервис-воркер «Сенім». Делает одно: без сети показывает страницу «Нет связи» (/offline)
 * вместо ошибки браузера. Ничего больше не кэширует — ни страниц с данными, ни ответов API
 * и Server Actions, ни файлов: приватные данные не остаются на телефоне.
 *
 * Переходы перехватываются только когда браузер знает, что сети нет (navigator.onLine === false).
 * При сети запросы идут мимо воркера как обычно — со входом, cookies, редиректами и паролем
 * демо-стенда: воркер не может показать окно basic-auth, поэтому в эти запросы не вмешивается.
 *
 * Изменили тексты офлайн-страницы — поменяйте версию в CACHE, чтобы телефоны забрали новую.
 */
const CACHE = "senim-offline-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Без cookies: страница общая для всех, в кэш не должно попасть ничего от сессии.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload", credentials: "omit" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("senim-") && name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate" || self.navigator.onLine) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match(OFFLINE_URL)) ?? Response.error();
      }
    })(),
  );
});
