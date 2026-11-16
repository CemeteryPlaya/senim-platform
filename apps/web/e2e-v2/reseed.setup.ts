import { execFileSync } from "node:child_process";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { assertSafeDatabase } from "./safe-database";

/**
 * Пересев базы e2e для набора `flows` (сценарии, меняющие данные): миграции и свежие данные стенда, как в e2e/global-setup.ts
 * (v1). Здесь проверка строже — только база нового интерфейса (assertSafeDatabase, safe-database.ts). Адрес —
 * E2E_DATABASE_URL, он же база dev-сервера e2e. Пересев стирает всё, что набрано руками на этой базе.
 *
 * Внимание: сид вызывает ResetStand в identity стенда — тот сбрасывает сессии и коды ВСЕГО стенда, в том числе вход людей
 * на сервере 3110 (владелец, другие прогоны). Защита от случайного запуска — только E2E_FLOWS=1 (проекты flows появляются
 * лишь с ней, playwright.v2.config.ts).
 */

setup("пересев базы e2e", () => {
  setup.setTimeout(180_000);
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  const env = { ...process.env, DATABASE_URL: url, APP_ENV: "dev" };
  const prismaCli = path.resolve("node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { env, stdio: "inherit" });
  try {
    execFileSync(process.execPath, [prismaCli, "db", "seed"], { env, stdio: "inherit" });
  } catch (e) {
    throw new Error("Сид e2e не прошёл. Если identity недоступен — запустите стенд v2: npm run v2:up", { cause: e });
  }
});
