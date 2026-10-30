import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "нужно 32 байта в base64");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    APP_URL: z.url().default("http://localhost:3100"),
    DEMO_MODE: bool,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    PII_ENCRYPTION_KEY: optional.pipe(base64Key.optional()),
    PII_HASH_KEY: optional.pipe(base64Key.optional()),

    SMS_PROVIDER: z.enum(["mock", "http"]).default("mock"),
    SMS_HTTP_URL: optional,
    SMS_HTTP_TOKEN: optional,
    SMS_SENDER: z.string().default("SENIM"),

    SIGNATURE_PROVIDER: z.enum(["mock", "sigex"]).default("mock"),
    SIGEX_BASE_URL: z.url().default("https://sigex.kz"),

    STORAGE_PROVIDER: z.enum(["local", "s3", "vercel-blob"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./storage"),
    FILE_URL_SECRET: optional,
    S3_ENDPOINT: optional,
    S3_REGION: optional,
    S3_BUCKET: optional,
    S3_ACCESS_KEY_ID: optional,
    S3_SECRET_ACCESS_KEY: optional,
    BLOB_READ_WRITE_TOKEN: optional,

    AI_ENABLED: bool,
    AI_PROVIDER: z.enum(["mock", "gateway"]).default("mock"),
    AI_GATEWAY_API_KEY: optional,
    AI_TEXT_MODEL: optional,
    AI_IMAGE_MODEL: optional,
    AI_MAX_VISUALIZATIONS_PER_REQUEST: z.coerce.number().int().min(0).default(3),

    PAYMENT_RAIL: z.enum(["manual", "escrow-simulator", "bank"]).default("manual"),
    ESCROW_SIMULATOR_WEBHOOK_SECRET: optional,
    BANK_API_URL: optional,
    BANK_WEBHOOK_SECRET: optional,

    AUTO_ACCEPT_DAYS: z.coerce.number().int().min(1).max(30).default(5),
    CRON_SECRET: optional,
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, when: string) => {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `обязательна, когда ${when}` });
    };
    if (env.NODE_ENV === "production") {
      require("PII_ENCRYPTION_KEY", "NODE_ENV=production");
      require("PII_HASH_KEY", "NODE_ENV=production");
      require("FILE_URL_SECRET", "NODE_ENV=production");
      require("CRON_SECRET", "NODE_ENV=production");
    }
    if (env.SMS_PROVIDER === "http") {
      require("SMS_HTTP_URL", "SMS_PROVIDER=http");
      require("SMS_HTTP_TOKEN", "SMS_PROVIDER=http");
    }
    if (env.STORAGE_PROVIDER === "s3") {
      for (const key of ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const)
        require(key, "STORAGE_PROVIDER=s3");
    }
    if (env.STORAGE_PROVIDER === "vercel-blob") require("BLOB_READ_WRITE_TOKEN", "STORAGE_PROVIDER=vercel-blob");
    if (env.AI_ENABLED && env.AI_PROVIDER === "gateway") {
      require("AI_GATEWAY_API_KEY", "AI_PROVIDER=gateway");
      require("AI_TEXT_MODEL", "AI_PROVIDER=gateway");
      require("AI_IMAGE_MODEL", "AI_PROVIDER=gateway");
    }
    // Симулятор банка в production (показ банку): вебхуки подписываются постоянным секретом, а не случайным секретом процесса.
    if (env.NODE_ENV === "production" && (env.PAYMENT_RAIL === "escrow-simulator" || env.DEMO_MODE)) {
      require("ESCROW_SIMULATOR_WEBHOOK_SECRET", "escrow-simulator или DEMO_MODE в production");
    }
    if (env.PAYMENT_RAIL === "bank") {
      require("BANK_API_URL", "PAYMENT_RAIL=bank");
      require("BANK_WEBHOOK_SECRET", "PAYMENT_RAIL=bank");
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Переменные окружения, проверенные один раз при первом обращении. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Некорректные переменные окружения:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Только для тестов: перечитать окружение после изменения process.env. */
export function resetEnvCache() {
  cached = undefined;
}
