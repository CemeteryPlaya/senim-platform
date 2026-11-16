import { defineConfig, devices } from "@playwright/test";
import { baseUse, webServer } from "./e2e/web-server";

// Сервер, база и переменные стенда v2 — общие с playwright.v2.config.ts (e2e/web-server.ts).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // сценарии меняют общие данные стенда
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // next dev собирает страницу при первом заходе: первые шаги сценария медленнее обычного.
  timeout: 60_000,
  expect: { timeout: 30_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: baseUse,
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } }, // основной экран — мобильный
    // Длинные сценарии денег (@flow) сами открывают мобильные контексты — на десктопе их не повторяем.
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@flow/ },
  ],
  webServer,
});
