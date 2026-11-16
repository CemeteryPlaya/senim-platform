import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PlaywrightTestConfig } from "@playwright/test";

/**
 * Общая часть конфигураций Playwright (v1 — playwright.config.ts, v2 — playwright.v2.config.ts): база e2e, переменные
 * стенда v2, порт и команда сервера Next. Конфиги отличаются только каталогом сценариев, проектами и пересевом данных.
 */

// E2E идут на отдельной базе senim_e2e с демо-данными: e2e/global-setup.ts пересоздаёт её перед прогоном.
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

export const baseUse: NonNullable<PlaywrightTestConfig["use"]> = {
  baseURL: `http://localhost:${PORT}`,
  locale: "ru-RU",
  timezoneId: "Asia/Almaty",
  trace: "retain-on-failure",
};

export const webServer: NonNullable<PlaywrightTestConfig["webServer"]> = {
  command: process.env.CI ? `npm run build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
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
    NEXT_DIST_DIR: ".next-e2e",
    SMS_PROVIDER: "mock",
    SIGNATURE_PROVIDER: "mock",
    PAYMENT_PROVIDER: "manual",
    ...V2_ENV,
  },
};
