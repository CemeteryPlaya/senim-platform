import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const KEY = Buffer.alloc(32, 1).toString("base64");

/** Минимальное рабочее окружение production без демо: пилот (APP_ENV=prod, manual), реальные SMS и ЭЦП. */
const production = {
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
};

/** Демо-стенд на Vercel: production-сборка, контур dev, моки за паролем показа. */
const demoProduction = {
  ...production,
  APP_ENV: "dev",
  DEMO_MODE: "true",
  SMS_PROVIDER: "mock",
  SIGNATURE_PROVIDER: "mock",
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

  it("APP_ENV задаётся явно: забытый контур в production не превращается в dev с тестовыми платежами", () => {
    const withoutAppEnv = Object.fromEntries(Object.entries(production).filter(([key]) => key !== "APP_ENV"));
    expect(problems(withoutAppEnv)).toMatch(/APP_ENV: обязательна, когда NODE_ENV=production/);
    expect(problems({ ...production, NODE_ENV: "development", APP_ENV: "" })).not.toMatch(/APP_ENV/);
  });

  it("без DEMO_MODE запрещает мок платежей — явный и по умолчанию контура dev", () => {
    expect(problems({ ...production, APP_ENV: "dev" })).toMatch(/PAYMENT_PROVIDER: mock запрещён в production без DEMO_MODE/);
    expect(problems({ ...production, APP_ENV: "dev", PAYMENT_PROVIDER: "manual" })).toBe("");
    expect(problems({ ...demoProduction, PAYMENT_PROVIDER: "mock" })).toBe("");
  });
});

describe("env: APP_ENV=prod без NODE_ENV=production", () => {
  it("секреты обязательны и при контуре prod", () => {
    const source = { DATABASE_URL: "postgresql://x", APP_ENV: "prod", SMS_PROVIDER: "http", SMS_HTTP_URL: "u", SMS_HTTP_TOKEN: "t", SIGNATURE_PROVIDER: "sigex" };
    for (const key of ["PII_ENCRYPTION_KEY", "PII_HASH_KEY", "FILE_URL_SECRET", "CRON_SECRET"]) {
      expect(problems(source)).toContain(`${key}: обязательна, когда APP_ENV=prod`);
    }
    expect(problems({ ...source, PII_ENCRYPTION_KEY: KEY, PII_HASH_KEY: KEY, FILE_URL_SECRET: "s", CRON_SECRET: "c" })).toBe("");
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

  it("production без секретов — по строке на каждый, в прежнем порядке", () => {
    expect(lines({ NODE_ENV: "production", APP_ENV: "prod", DATABASE_URL: "postgresql://x", TRUST_PROXY: "true", SMS_PROVIDER: "http", SMS_HTTP_URL: "u", SMS_HTTP_TOKEN: "t", SIGNATURE_PROVIDER: "sigex" })).toEqual(
      ["PII_ENCRYPTION_KEY", "PII_HASH_KEY", "FILE_URL_SECRET", "CRON_SECRET"].map((k) => `${k}: обязательна, когда NODE_ENV=production`),
    );
  });
});


describe("env: контуры APP_ENV (ТЗ п. 11)", () => {
  const prod = { ...production, APP_ENV: "prod" };

  it("dev по умолчанию — провайдер mock", async () => {
    const { resolvePaymentProvider } = await import("./env");
    expect(resolvePaymentProvider(parseEnv({ DATABASE_URL: "postgresql://x" }))).toBe("mock");
  });

  it("prod без моков — провайдер manual", async () => {
    const { resolvePaymentProvider } = await import("./env");
    expect(problems(prod)).toBe("");
    expect(resolvePaymentProvider(parseEnv(prod))).toBe("manual");
  });

  it.each([
    ["DEMO_MODE", { DEMO_MODE: "true", DEMO_ACCESS_PASSWORD: "пароль-показа-банку" }],
    ["SMS_PROVIDER", { SMS_PROVIDER: "mock" }],
    ["SIGNATURE_PROVIDER", { SIGNATURE_PROVIDER: "mock" }],
    ["PAYMENT_PROVIDER", { PAYMENT_PROVIDER: "mock" }],
  ])("prod запрещает %s в демо- или мок-режиме", (key, extra) => {
    expect(problems({ ...prod, ...extra })).toContain(`${key}:`);
  });

  it("freedompay запрещён вне staging, в том числе в prod", () => {
    expect(problems({ ...prod, PAYMENT_PROVIDER: "freedompay" })).toContain("только при APP_ENV=staging");
    expect(problems({ DATABASE_URL: "postgresql://x", PAYMENT_PROVIDER: "freedompay" })).toContain("только при APP_ENV=staging");
  });

  it("staging по умолчанию — песочница Freedom Pay, ей нужны ключи", () => {
    const message = problems({ DATABASE_URL: "postgresql://x", APP_ENV: "staging" });
    expect(message).toContain("FREEDOMPAY_MERCHANT_ID");
    expect(message).toContain("FREEDOMPAY_SECRET_KEY");
  });

  it("ключи VAPID задаются вместе", () => {
    expect(problems({ DATABASE_URL: "postgresql://x", VAPID_PUBLIC_KEY: "p" })).toContain("VAPID_PRIVATE_KEY");
  });
});

describe("v2: MESH_* и V2_ENABLED", () => {
  const minimal = { DATABASE_URL: "postgresql://x" };

  it("по умолчанию v2 выключен и MESH_* не нужны", () => {
    const e = parseEnv(minimal);
    expect(e.V2_ENABLED).toBe(false);
    expect(e.MESH_URL).toBeUndefined();
  });

  it("V2_ENABLED=true вне prod не требует MESH_*", () => {
    expect(parseEnv({ ...minimal, V2_ENABLED: "true" }).V2_ENABLED).toBe(true);
  });

  it("APP_ENV=prod и V2_ENABLED=true требуют все четыре MESH_*", () => {
    const msg = problems({ ...production, V2_ENABLED: "true" });
    for (const key of ["MESH_URL", "MESH_TLS_CERT_FILE", "MESH_TLS_KEY_FILE", "MESH_TLS_CA_FILE"]) expect(msg).toContain(key);
  });

  it("APP_ENV=prod с полным набором MESH_* проходит", () => {
    const full = {
      ...production,
      V2_ENABLED: "true",
      MESH_URL: "https://mesh:9443",
      MESH_TLS_CERT_FILE: "/c.pem",
      MESH_TLS_KEY_FILE: "/k.pem",
      MESH_TLS_CA_FILE: "/ca.pem",
    };
    expect(problems(full)).toBe("");
  });

  it("APP_ENV=prod без V2_ENABLED не требует MESH_*", () => {
    expect(problems(production)).toBe("");
  });

  it("APP_ENV=prod и http-адрес mesh — ошибка по MESH_URL", () => {
    const msg = problems({ ...production, V2_ENABLED: "true", MESH_URL: "http://mesh:9443", MESH_TLS_CERT_FILE: "/c", MESH_TLS_KEY_FILE: "/k", MESH_TLS_CA_FILE: "/ca" });
    expect(msg).toContain("MESH_URL");
    expect(msg).toContain("https://");
  });

  it("APP_ENV=staging без файла сертификата — ошибка", () => {
    const msg = problems({ DATABASE_URL: "postgresql://x", APP_ENV: "staging", V2_ENABLED: "true", MESH_URL: "https://mesh:9443", MESH_TLS_KEY_FILE: "/k", MESH_TLS_CA_FILE: "/ca" });
    expect(msg).toContain("MESH_TLS_CERT_FILE");
  });
});
