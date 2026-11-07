import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Демо-стенд (DEMO_MODE=true) пускает в любую персону без SMS, показывает код входа на экране
 * и умеет «Сбросить демо». Если задан DEMO_ACCESS_PASSWORD, весь сайт закрыт basic-auth
 * (src/proxy.ts). Без пароля не закрываются только вызовы извне — точные пути вебхуков банка
 * и cron, у них своя проверка подписи и секрета (CRON_SECRET при демо с паролем требует env.ts), —
 * и публичные файлы установки приложения (манифест, значки, сервис-воркер, страница «Нет связи»).
 * Префикс не годится: любой новый маршрут под /api/webhooks/ оказался бы открыт без пароля.
 */
const EXEMPT_PATHS: ReadonlySet<string> = new Set([
  "/api/webhooks/payments/mock",
  "/api/webhooks/payments/freedompay",
  "/api/cron/run",
  // Установка приложения: браузер запрашивает манифест, значки и сервис-воркер без пароля basic-auth.
  // Данных стенда в них нет — название, цвета, значки и страница «Нет связи».
  "/manifest.webmanifest",
  "/sw.js",
  "/offline",
  "/apple-icon.png",
]);
/** Значки из public/icons: только PNG прямо в папке, без вложенных путей. */
const EXEMPT_ICON = /^\/icons\/[a-z0-9-]+\.png$/;

export type DemoGateConfig = { demoMode: boolean; password: string | undefined };

/** sha256 выравнивает длину: сравнение не выдаёт длину пароля по времени. */
function sameSecret(a: string, b: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** Пароль из заголовка `Authorization: Basic base64(имя:пароль)`; имя не проверяется. */
function basicPassword(authorization: string | null): string | null {
  const match = authorization?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const pair = Buffer.from(match[1], "base64").toString("utf8");
  const colon = pair.indexOf(":");
  return colon === -1 ? null : pair.slice(colon + 1);
}

export function demoGate(pathname: string, authorization: string | null, config: DemoGateConfig): "pass" | "challenge" {
  if (!config.demoMode || !config.password) return "pass";
  if (EXEMPT_PATHS.has(pathname) || EXEMPT_ICON.test(pathname)) return "pass";
  const given = basicPassword(authorization);
  return given !== null && sameSecret(given, config.password) ? "pass" : "challenge";
}
