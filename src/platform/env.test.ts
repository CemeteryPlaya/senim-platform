import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const KEY = Buffer.alloc(32, 1).toString("base64");

/** Минимальное рабочее окружение production без демо: реальные SMS и ЭЦП. */
const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://x",
  PII_ENCRYPTION_KEY: KEY,
  PII_HASH_KEY: KEY,
  FILE_URL_SECRET: "s",
  CRON_SECRET: "c",
  SMS_PROVIDER: "http",
  SMS_HTTP_URL: "https://sms.example",
  SMS_HTTP_TOKEN: "t",
  SIGNATURE_PROVIDER: "sigex",
};

const demoProduction = {
  ...production,
  DEMO_MODE: "true",
  SMS_PROVIDER: "mock",
  SIGNATURE_PROVIDER: "mock",
  ESCROW_SIMULATOR_WEBHOOK_SECRET: "w",
  DEMO_ACCESS_PASSWORD: "пароль-показа",
};

function problems(source: Record<string, string>): string {
  try {
    parseEnv(source);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe("env: production", () => {
  it("рабочее окружение без моков проходит", () => {
    expect(problems(production)).toBe("");
  });

  it("без DEMO_MODE запрещает мок SMS", () => {
    expect(problems({ ...production, SMS_PROVIDER: "mock" })).toMatch(/SMS_PROVIDER/);
  });

  it("без DEMO_MODE запрещает мок подписи", () => {
    expect(problems({ ...production, SIGNATURE_PROVIDER: "mock" })).toMatch(/SIGNATURE_PROVIDER/);
  });

  it("демо-стенд с паролем может работать на моках", () => {
    expect(problems(demoProduction)).toBe("");
  });
});

describe("env: разработка", () => {
  it("моки и демо без пароля разрешены", () => {
    expect(problems({ DATABASE_URL: "postgresql://x", DEMO_MODE: "true" })).toBe("");
  });
});
