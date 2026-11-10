import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Готовит E2E-базу: миграции и свежие демо-данные. Сид при DEMO_MODE=true очищает таблицы
 * сам (resetDemo), поэтому `migrate reset` не нужен. Защита: работаем только с базой «*e2e*».
 * Люди сида заводятся в identity стенда v2 (ResetDemo, SeedUsers): без `npm run v2:up` сид падает сразу,
 * с подсказкой в выводе. Переменные V2_ENABLED и MESH_* подставляет playwright.config.ts.
 */
export default function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "";
  if (!/e2e/i.test(new URL(url).pathname)) throw new Error("E2E_DATABASE_URL должна указывать на отдельную базу с «e2e» в имени");
  const env = { ...process.env, DATABASE_URL: url, DEMO_MODE: "true" };
  const prismaCli = path.resolve("node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { env, stdio: "inherit" });
  try {
    execFileSync(process.execPath, [prismaCli, "db", "seed"], { env, stdio: "inherit" });
  } catch (e) {
    throw new Error("Сид e2e не прошёл, причина — в выводе выше. Если identity недоступен — запустите стенд v2: npm run v2:up", { cause: e });
  }
}
