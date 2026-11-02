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
  TRUST_PROXY: "true",
};

const demoProduction = {
  ...production,
  DEMO_MODE: "true",
  SMS_PROVIDER: "mock",
  SIGNATURE_PROVIDER: "mock",
  ESCROW_SIMULATOR_WEBHOOK_SECRET: "w",
  DEMO_ACCESS_PASSWORD: "пароль-показа-банку",
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

  it("TRUST_PROXY=true обязательна: без IP клиента лимиты кодов входа держатся только на общем потолке", () => {
    expect(problems({ ...production, TRUST_PROXY: "" })).toMatch(/TRUST_PROXY/);
    expect(problems({ ...production, TRUST_PROXY: "false" })).toMatch(/TRUST_PROXY/);
    expect(problems({ ...demoProduction, TRUST_PROXY: "false" })).toMatch(/TRUST_PROXY/);
    expect(problems({ ...production, NODE_ENV: "development", TRUST_PROXY: "false" })).toBe("");
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

  it("демо-стенд без пароля не запускается", () => {
    expect(problems({ ...demoProduction, DEMO_ACCESS_PASSWORD: "" })).toMatch(/DEMO_ACCESS_PASSWORD/);
  });

  it("пароль показа — не короче 16 символов", () => {
    expect(problems({ ...demoProduction, DEMO_ACCESS_PASSWORD: "короткий-пароль" })).toMatch(/DEMO_ACCESS_PASSWORD: не короче 16/);
    expect(problems({ ...demoProduction, DEMO_ACCESS_PASSWORD: "ровно-16-символ!" })).toBe("");
  });

  it("демо-стенд без CRON_SECRET не запускается", () => {
    expect(problems({ ...demoProduction, CRON_SECRET: "" })).toMatch(/CRON_SECRET/);
  });
});

describe("env: разработка", () => {
  it("моки и демо без пароля разрешены", () => {
    expect(problems({ DATABASE_URL: "postgresql://x", DEMO_MODE: "true" })).toBe("");
  });

  it("демо за паролем показа требует CRON_SECRET и длинный пароль и при разработке", () => {
    const demo = { DATABASE_URL: "postgresql://x", DEMO_MODE: "true", DEMO_ACCESS_PASSWORD: "пароль-показа-банку" };
    expect(problems(demo)).toMatch(/CRON_SECRET/);
    expect(problems({ ...demo, CRON_SECRET: "c" })).toBe("");
    expect(problems({ ...demo, CRON_SECRET: "c", DEMO_ACCESS_PASSWORD: "123" })).toMatch(/DEMO_ACCESS_PASSWORD/);
  });
});

describe("env: обязательные переменные выбранных провайдеров", () => {
  const dev = { DATABASE_URL: "postgresql://x" };
  const lines = (source: Record<string, string>) =>
    problems(source)
      .split("\n")
      .slice(1)
      .map((l) => l.trim());

  it("SMS по HTTP — адрес и токен", () => {
    expect(lines({ ...dev, SMS_PROVIDER: "http" })).toEqual(["SMS_HTTP_URL: обязательна, когда SMS_PROVIDER=http", "SMS_HTTP_TOKEN: обязательна, когда SMS_PROVIDER=http"]);
  });

  it("S3 — все пять параметров; Vercel Blob — токен", () => {
    expect(lines({ ...dev, STORAGE_PROVIDER: "s3" })).toEqual(
      ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].map((k) => `${k}: обязательна, когда STORAGE_PROVIDER=s3`),
    );
    expect(lines({ ...dev, STORAGE_PROVIDER: "vercel-blob" })).toEqual(["BLOB_READ_WRITE_TOKEN: обязательна, когда STORAGE_PROVIDER=vercel-blob"]);
  });

  it("ИИ через шлюз — ключ и модели, но только когда ИИ включён", () => {
    expect(lines({ ...dev, AI_ENABLED: "true", AI_PROVIDER: "gateway" })).toEqual(
      ["AI_GATEWAY_API_KEY", "AI_TEXT_MODEL", "AI_IMAGE_MODEL"].map((k) => `${k}: обязательна, когда AI_PROVIDER=gateway`),
    );
    expect(problems({ ...dev, AI_PROVIDER: "gateway" })).toBe("");
  });

  it("рельс банка — адрес API и секрет вебхуков", () => {
    expect(lines({ ...dev, PAYMENT_RAIL: "bank" })).toEqual(["BANK_API_URL: обязательна, когда PAYMENT_RAIL=bank", "BANK_WEBHOOK_SECRET: обязательна, когда PAYMENT_RAIL=bank"]);
  });

  it("симулятор банка в production — постоянный секрет вебхуков; при разработке не нужен", () => {
    expect(lines({ ...production, PAYMENT_RAIL: "escrow-simulator" })).toEqual([
      "ESCROW_SIMULATOR_WEBHOOK_SECRET: обязательна, когда escrow-simulator или DEMO_MODE в production",
    ]);
    expect(problems({ ...dev, PAYMENT_RAIL: "escrow-simulator" })).toBe("");
  });

  it("production без секретов — по строке на каждый, в прежнем порядке", () => {
    expect(lines({ NODE_ENV: "production", DATABASE_URL: "postgresql://x", TRUST_PROXY: "true", SMS_PROVIDER: "http", SMS_HTTP_URL: "u", SMS_HTTP_TOKEN: "t", SIGNATURE_PROVIDER: "sigex" })).toEqual(
      ["PII_ENCRYPTION_KEY", "PII_HASH_KEY", "FILE_URL_SECRET", "CRON_SECRET"].map((k) => `${k}: обязательна, когда NODE_ENV=production`),
    );
  });
});

