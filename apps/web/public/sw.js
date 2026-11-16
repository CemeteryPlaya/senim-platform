/*
 * Сервис-воркер «Сенім». Делает две вещи:
 * 1) без сети показывает страницу «Нет связи» (/offline) вместо ошибки браузера. Ничего больше
 *    не кэширует — ни страниц с данными, ни ответов API и Server Actions, ни файлов: приватные
 *    данные не остаются на телефоне;
 * 2) показывает web push (заголовок события, общий текст, ссылка внутрь приложения) и по нажатию
 *    открывает ссылку. Данные push в кэш не пишутся.
 *
 * Переходы перехватываются только когда браузер знает, что сети нет (navigator.onLine === false).
 * При сети запросы идут мимо воркера как обычно — со входом, cookies, редиректами и паролем
 * демо-стенда: воркер не может показать окно basic-auth, поэтому в эти запросы не вмешивается.
 *
 * Офлайн-страниц две: для адресов /v2 — в виде нового интерфейса (/offline?v=2, светлая и тёмная тема), для остальных —
 * прежняя (/offline, v1 заморожен).
 *
 * Изменили тексты или вид офлайн-страницы — поменяйте версию в CACHE, чтобы телефоны забрали новую.
 */
const CACHE = "senim-offline-v2";
const OFFLINE_URL = "/offline";
const OFFLINE_V2_URL = "/offline?v=2";

/** Какую офлайн-страницу показать вместо адреса: новый интерфейс — свою. */
function offlineFor(url) {
  const path = new URL(url).pathname;
  return path === "/v2" || path.startsWith("/v2/") ? OFFLINE_V2_URL : OFFLINE_URL;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Без cookies: страница общая для всех, в кэш не должно попасть ничего от сессии.
      for (const url of [OFFLINE_URL, OFFLINE_V2_URL]) await cache.add(new Request(url, { cache: "reload", credentials: "omit" }));
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
        return (await caches.match(offlineFor(request.url))) ?? (await caches.match(OFFLINE_URL)) ?? Response.error();
      }
    })(),
  );
});

/** Страница уведомлений нового интерфейса: запасной адрес. */
const NOTIFICATIONS_URL = "/v2/notifications";

/** Только путь внутри сайта: «/deals/…». Чужой адрес или «//host» — страница уведомлений. */
function safePath(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\") ? url : NOTIFICATIONS_URL;
}

/**
 * Куда вести нажатие на уведомление. У push с `tag` (id уведомления в модуле) — обработчик /v2/notifications/<tag>/open: он
 * отметит уведомление прочитанным и откроет нужный экран в новом интерфейсе (ссылка в push — путь старого). Без `tag` — путь из
 * данных уведомления, а без него — страница уведомлений v2.
 */
function targetFor(notification) {
  const tag = notification && typeof notification.tag === "string" ? notification.tag : "";
  if (tag) return NOTIFICATIONS_URL + "/" + encodeURIComponent(tag) + "/open";
  return safePath(notification && notification.data && notification.data.url);
}

/** Сервер присылает { title, body, url, tag } (notifications.sendPush). Тексты — с сервера: здесь своих нет. */
function readPush(data) {
  try {
    const message = data ? data.json() : null;
    if (message && typeof message.title === "string" && message.title) {
      return { title: message.title, body: typeof message.body === "string" ? message.body : "", url: safePath(message.url), tag: typeof message.tag === "string" ? message.tag : undefined };
    }
  } catch {
    // Не JSON — покажем общее уведомление: push без показа браузер считает нарушением.
  }
  return { title: self.location.hostname, body: "", url: NOTIFICATIONS_URL, tag: undefined };
}

self.addEventListener("push", (event) => {
  const message = readPush(event.data);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag, // повтор того же уведомления заменяет прежнее, а не показывает второе
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(targetFor(event.notification), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        return open.navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
