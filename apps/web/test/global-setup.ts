import { execFileSync } from "node:child_process";
import path from "node:path";
import { TEST_DATABASE_URL } from "./db-url";

/** Один раз перед интеграционными тестами: применить миграции к тестовой базе. */
export default function setup() {
  const prismaCli = path.resolve("node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
