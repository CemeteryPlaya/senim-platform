import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PlaywrightTestConfig } from "@playwright/test";

/**
 * Общая часть конфигураций Playwright (v1 — playwright.config.ts, v2 — playwright.v2.config.ts): база e2e, переменные
 * стенда v2, порт и команда сервера Next. Конфиги отличаются только каталогом сценариев, проектами и пересевом данных.
 */

// E2E идут на отдельной базе e2e с данными стенда: e2e/global-setup.ts пересоздаёт её перед прогоном.
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
if (!E2E_DATABASE_URL) throw new Error("Задайте E2E_DATABASE_URL (пример — в .env.example)");

/**
 * Вход и сессии — в identity стенда v2 (npm run v2:up): web ходит к mesh по mTLS. Значения по умолчанию —
 * e2e/v2.vars.example (пути к сертификатам — от apps/web); переменная из командной строки важнее. Пишутся в
 * process.env: их наследуют global-setup, reseed() в сценариях и сервер Next.
 */
function v2Defaults(): Record<string, string> {
  const root = path.join(__dirname, "..");
  const file = path.join(__dirname, "v2.vars.example");
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[1].endsWith("_FILE") ? path.resolve(root, m[2]) : m[2];
  }
  return vars;
}
for (const [key, value] of Object.entries(v2Defaults())) process.env[key] ??= value;
const V2_ENV = Object.fromEntries(
  ["V2_ENABLED", "MESH_URL", "MESH_TLS_CERT_FILE", "MESH_TLS_KEY_FILE", "MESH_TLS_CA_FILE"].map((k) => [k, process.env[k] ?? ""]),
);

// Свой порт, не порт dev-сервера: reuseExistingServer иначе прогнал бы e2e против dev-базы.
export const PORT = Number(process.env.E2E_PORT ?? 3110);

/**
 * Пароль стенда (basic-auth, src/proxy.ts). Production-сборка с моком SMS без него не стартует (env.ts, Ruling P5-3), поэтому
 * в CI (`next start`) он задан всегда — тестовый, если не передан; dev-сервер локально — без пароля, если не передан.
 * Браузер и запросы сценариев входят с ним через `httpCredentials`.
 */
const STAND_PASSWORD = process.env.STAND_ACCESS_PASSWORD ?? (process.env.CI ? "e2e-stand-password-local-only" : undefined);

export const baseUse: NonNullable<PlaywrightTestConfig["use"]> = {
  baseURL: `http://localhost:${PORT}`,
  locale: "ru-RU",
  timezoneId: "Asia/Almaty",
  trace: "retain-on-failure",
  ...(STAND_PASSWORD ? { httpCredentials: { username: "stand", password: STAND_PASSWORD } } : {}),
};

// Папка сборки e2e-сервера (NEXT_DIST_DIR ниже).
const DIST_DIR = ".next-e2e";

export const webServer: NonNullable<PlaywrightTestConfig["webServer"]> = {
  // Перед `next dev` — предохранитель от разросшегося кэша Turbopack (e2e/turbopack-cache.ts). Команда запускается, только
  // когда сервер не поднят (reuseExistingServer): кэш работающего сервера не трогается.
  command: process.env.CI ? `npm run build && npx next start -p ${PORT}` : `npx tsx e2e/trim-turbopack-cache.ts ${DIST_DIR} && npx next dev -p ${PORT}`,
  port: PORT,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  // NEXT_DIST_DIR — своя папка сборки: иначе `next dev` не стартует рядом с `npm run dev` (блокировка на папку).
  // PAYMENT_PROVIDER=manual — новые сделки e2e идут по пути пилота (ТЗ п. 10): операции подтверждает оператор;
  // сделки сида сохраняют своего провайдера (mock или manual).
  env: {
    DATABASE_URL: E2E_DATABASE_URL,
    // В CI сервер — `next start` (NODE_ENV=production): env.ts требует явный APP_ENV (OPEN_QUESTIONS №62).
    APP_ENV: "dev",
    NEXT_DIST_DIR: DIST_DIR,
    SMS_PROVIDER: "mock",
    SIGNATURE_PROVIDER: "mock",
    PAYMENT_PROVIDER: "manual",
    ...(STAND_PASSWORD ? { STAND_ACCESS_PASSWORD: STAND_PASSWORD } : {}),
    ...V2_ENV,
  },
};
