import { execFileSync } from "node:child_process";
import path from "node:path";
import { test as setup } from "@playwright/test";

/**
 * Пересев базы e2e для набора `flows` (сценарии, меняющие данные): миграции и свежие демо-данные, как в e2e/global-setup.ts
 * (v1). Здесь проверка строже: только база нового интерфейса — имя начинается с «senim_v2web_». Любая другая (в том числе
 * senim, senim_test, senim_e2e) — отказ до первого запроса. Адрес — E2E_DATABASE_URL, он же база dev-сервера e2e.
 * Пересев стирает всё, что набрано руками на этой базе.
 */

const SAFE_DATABASE_PREFIX = "senim_v2web_";

/** Имя базы из адреса или ошибка с понятным текстом. */
export function assertSafeDatabase(url: string): string {
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\/+/, "");
  } catch {
    throw new Error("E2E_DATABASE_URL не разобрать как адрес базы: пересев не выполняется.");
  }
  if (!name.startsWith(SAFE_DATABASE_PREFIX)) {
    throw new Error(
      `Пересев отказан: база «${name || "(без имени)"}» не начинается с «${SAFE_DATABASE_PREFIX}». Набор flows работает только на базе нового интерфейса (например, ${SAFE_DATABASE_PREFIX}e2e).`,
    );
  }
  return name;
}

setup("пересев базы e2e", () => {
  setup.setTimeout(180_000);
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  const env = { ...process.env, DATABASE_URL: url, DEMO_MODE: "true" };
  const prismaCli = path.resolve("node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { env, stdio: "pipe" });
  try {
    execFileSync(process.execPath, [prismaCli, "db", "seed"], { env, stdio: "pipe" });
  } catch (e) {
    throw new Error("Сид e2e не прошёл. Если identity недоступен — запустите стенд v2: npm run v2:up", { cause: e });
  }
});
