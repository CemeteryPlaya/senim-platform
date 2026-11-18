import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { TEST_DATABASE_URL } from "./db-url";
import { createRunStorageRoot, removeStaleRunRoots, TEST_STORAGE_ROOT_ENV } from "./storage-dir";

/**
 * Один раз перед интеграционными тестами: применить миграции к тестовой базе и завести папку хранилища прогона
 * (test/storage-dir.ts). Папка передаётся тестам через process.env (воркеры наследуют окружение) и удаляется в teardown.
 */
export default async function setup() {
  const prismaCli = path.resolve("node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
  await removeStaleRunRoots();
  const root = await createRunStorageRoot();
  process.env[TEST_STORAGE_ROOT_ENV] = root;
  return async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  };
}
