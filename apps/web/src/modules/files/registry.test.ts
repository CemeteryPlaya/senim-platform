import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { storageByName } from "./registry";

const KEY = Buffer.alloc(32, 1).toString("base64");
/** Минимальное рабочее окружение пилота (APP_ENV=prod): как в env.test.ts. */
const PROD = {
  NODE_ENV: "production",
  APP_ENV: "prod",
  DATABASE_URL: "postgresql://x",
  PII_ENCRYPTION_KEY: KEY,
  PII_HASH_KEY: KEY,
  FILE_URL_SECRET: "s",
  CRON_SECRET: "c",
  SMS_PROVIDER: "http",
  SMS_HTTP_URL: "https://sms.example",
  SMS_HTTP_TOKEN: "t",
  SIGNATURE_PROVIDER: "sigex",
  TRUST_PROXY: "true",
} as const;

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("storageByName: файлы сида (static)", () => {
  it("при APP_ENV=prod недоступны — ошибка называет провайдер", async () => {
    Object.assign(process.env, PROD);
    resetEnvCache();
    await expect(storageByName("static")).rejects.toThrow(/static/);
  });

  it("при APP_ENV=dev читаются из public/", async () => {
    Object.assign(process.env, { APP_ENV: "dev", DATABASE_URL: "postgresql://x" });
    resetEnvCache();
    await expect(storageByName("static")).resolves.toHaveProperty("delete");
  });
});
