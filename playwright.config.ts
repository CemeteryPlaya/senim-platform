import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// E2E идут на отдельной базе senim_e2e с демо-данными: e2e/global-setup.ts пересоздаёт её перед прогоном.
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
if (!E2E_DATABASE_URL) throw new Error("Задайте E2E_DATABASE_URL (пример — в .env.example)");

// Свой порт, не порт dev-сервера: reuseExistingServer иначе прогнал бы e2e против dev-базы.
const PORT = Number(process.env.E2E_PORT ?? 3110);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // сценарии меняют общие демо-данные
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } }, // основной экран — мобильный
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: process.env.CI ? `npm run build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { DATABASE_URL: E2E_DATABASE_URL, DEMO_MODE: "true", SMS_PROVIDER: "mock", SIGNATURE_PROVIDER: "mock" },
  },
});
