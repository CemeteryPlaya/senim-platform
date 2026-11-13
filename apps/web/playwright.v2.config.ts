import { defineConfig, devices } from "@playwright/test";
import { baseUse, webServer } from "./e2e/web-server";

// Новый интерфейс (/v2): те же сервер, порт и стенд, что у v1 (e2e/web-server.ts).
// Два набора проектов:
//  - mobile / desktop — сценарии каркаса, гостя, входа и онбординга (e2e-v2/*.spec.ts): данные не пересеваются, номера новые;
//  - flows-mobile / flows-desktop — сценарии, меняющие данные (e2e-v2/flows/*.spec.ts): перед ними один раз за прогон
//    проект `reseed` пересевает базу e2e (e2e-v2/reseed.setup.ts; только база «senim_v2web_*»).
//    Пересев стирает данные базы, поэтому эти проекты (и reseed) появляются только при E2E_FLOWS=1: обычный прогон
//    (npm run test:e2e:v2, mobile + desktop) базу не трогает.
//    Запуск: E2E_FLOWS=1 npx playwright test -c playwright.v2.config.ts --project flows-mobile
const FLOWS = "flows/**/*.spec.ts";
const withFlows = process.env.E2E_FLOWS === "1";

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
    { name: "mobile", testIgnore: [FLOWS, "reseed.setup.ts"], use: { ...devices["Pixel 7"] } },
    { name: "desktop", testIgnore: [FLOWS, "reseed.setup.ts"], use: { ...devices["Desktop Chrome"] } },
    ...(withFlows
      ? [
          { name: "reseed", testMatch: "reseed.setup.ts" },
          { name: "flows-mobile", testMatch: FLOWS, dependencies: ["reseed"], use: { ...devices["Pixel 7"] } },
          { name: "flows-desktop", testMatch: FLOWS, dependencies: ["reseed"], use: { ...devices["Desktop Chrome"] } },
        ]
      : []),
  ],
  webServer,
});
