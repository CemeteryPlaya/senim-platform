import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// E2E идут на отдельной базе senim_e2e с демо-данными: e2e/global-setup.ts пересоздаёт её перед прогоном.
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
if (!E2E_DATABASE_URL) throw new Error("Задайте E2E_DATABASE_URL (пример — в .env.example)");

/**
 * Вход и сессии — в identity стенда v2 (npm run v2:up): web ходит к mesh по mTLS. Значения по умолчанию —
 * e2e/v2.vars.example (пути к сертификатам — от apps/web); переменная из командной строки важнее. Пишутся в
 * process.env: их наследуют global-setup, reseed() в сценариях и сервер Next.
 */
function v2Defaults(): Record<string, string> {
  const file = path.join(__dirname, "e2e", "v2.vars.example");
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[1].endsWith("_FILE") ? path.resolve(__dirname, m[2]) : m[2];
  }
  return vars;
}
for (const [key, value] of Object.entries(v2Defaults())) process.env[key] ??= value;
const V2_ENV = Object.fromEntries(
  ["V2_ENABLED", "MESH_URL", "MESH_TLS_CERT_FILE", "MESH_TLS_KEY_FILE", "MESH_TLS_CA_FILE"].map((k) => [k, process.env[k] ?? ""]),
);

// Свой порт, не порт dev-сервера: reuseExistingServer иначе прогнал бы e2e против dev-базы.
const PORT = Number(process.env.E2E_PORT ?? 3110);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // сценарии меняют общие демо-данные
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // next dev собирает страницу при первом заходе: первые шаги сценария медленнее обычного.
  timeout: 60_000,
  expect: { timeout: 30_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } }, // основной экран — мобильный
    // Длинные сценарии денег (@flow) сами открывают мобильные контексты — на десктопе их не повторяем.
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@flow/ },
  ],
  webServer: {
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
      DEMO_MODE: "true",
      SMS_PROVIDER: "mock",
      SIGNATURE_PROVIDER: "mock",
      PAYMENT_PROVIDER: "manual",
      ...V2_ENV,
    },
  },
});
