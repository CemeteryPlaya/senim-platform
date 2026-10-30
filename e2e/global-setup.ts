import { execFileSync } from "node:child_process";
import path from "node:path";

/** Пересоздаёт E2E-базу и загружает демо-данные. */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL };
  const prismaCli = path.resolve("node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "reset", "--force"], { env, stdio: "inherit" });
  execFileSync(process.execPath, [prismaCli, "db", "seed"], { env, stdio: "inherit" });
}
