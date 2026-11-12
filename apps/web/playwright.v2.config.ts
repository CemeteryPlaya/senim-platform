import { defineConfig, devices } from "@playwright/test";
import { baseUse, webServer } from "./e2e/web-server";

// Новый интерфейс (/v2): те же сервер, порт и стенд, что у v1 (e2e/web-server.ts), но без пересева базы —
// сценарии каркаса данных не меняют, поэтому глобальной подготовки нет.
export default defineConfig({
  testDir: "./e2e-v2",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // next dev собирает страницу при первом заходе: первые шаги сценария медленнее обычного.
  timeout: 60_000,
  expect: { timeout: 30_000 },
  use: baseUse,
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer,
});
