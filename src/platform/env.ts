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

const base = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Контур (ТЗ п. 11): dev — моки, staging — песочница Freedom Pay, prod — пилот на manual-провайдере. */
    APP_ENV: z.enum(["dev", "staging", "prod"]).default("dev"),
    DATABASE_URL: z.string().min(1),
    APP_URL: z.url().default("http://localhost:3100"),
    DEMO_MODE: bool,
    DEMO_ACCESS_PASSWORD: optional,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    TRUST_PROXY: bool,

    PII_ENCRYPTION_KEY: optional.pipe(base64Key.optional()),
    PII_HASH_KEY: optional.pipe(base64Key.optional()),

    SMS_PROVIDER: z.enum(["mock", "http"]).default("mock"),
    SMS_HTTP_URL: optional,
    SMS_HTTP_TOKEN: optional,
    SMS_SENDER: z.string().default("SENIM"),
    /**
     * Сколько кодов входа платформа отправляет за сутки на незарегистрированные номера — потолок расходов на SMS
     * при рассылке с разных IP. Зарегистрированные входят по лимитам своего номера, потолок их не закрывает.
     */
    OTP_DAILY_GLOBAL_LIMIT: z.coerce.number().int().min(1).default(500),
    /** То же на префикс номера (первые 6 цифр, «770012…»): перебор соседних номеров не выбирает весь общий потолок. */
    OTP_DAILY_PREFIX_LIMIT: z.coerce.number().int().min(1).default(50),

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
    AI_DAILY_BUDGET_USD: z.coerce.number().min(0).default(20),

    /** Платёжный провайдер новых сделок (ADR-009); по умолчанию — по APP_ENV (DEFAULT_PAYMENT_PROVIDER). */
    PAYMENT_PROVIDER: z.enum(["mock", "manual", "freedompay"]).optional(),
    FREEDOMPAY_API_URL: optional,
    FREEDOMPAY_MERCHANT_ID: optional,
    FREEDOMPAY_SECRET_KEY: optional,
    FREEDOMPAY_PAYOUT_SECRET_KEY: optional,
    /** Устарело (ADR-009): режимы до ТЗ; удаляется вместе со старым модулем payments. */
    PAYMENT_RAIL: z.enum(["manual", "escrow-simulator", "bank"]).default("manual"),
    ESCROW_SIMULATOR_WEBHOOK_SECRET: optional,
    BANK_API_URL: optional,
    BANK_WEBHOOK_SECRET: optional,

    /** Web push (VAPID): ключи выдаёт `npx web-push generate-vapid-keys`; без них push выключен, in-app работает. */
    VAPID_PUBLIC_KEY: optional,
    VAPID_PRIVATE_KEY: optional,
    VAPID_SUBJECT: optional,
    EMAIL_PROVIDER: z.enum(["mock"]).default("mock"),
    EMAIL_FROM: optional,
    GEOCODER_PROVIDER: z.enum(["mock"]).default("mock"),
    /** Радиус мягкой проверки GPS при сдаче, метры (ТЗ п. 7). */
    READY_GPS_RADIUS_M: z.coerce.number().int().min(50).max(5000).default(500),

    // Флаги Фазы 1 (platform/features.ts): по умолчанию всё вне Фазы 1 выключено. ИИ — AI_ENABLED.
    FEATURE_PRE_CONTRACT_FLOWS: bool,
    FEATURE_MATERIALS_CALCULATOR: bool,
    FEATURE_REVIEWS: bool,
    FEATURE_DEAL_PORTFOLIO: bool,
    FEATURE_INSPIRATION: bool,
    FEATURE_PUBLIC_SHOWCASE: bool,
    FEATURE_EXECUTOR_HAND_SIGNS_ACT: bool,
    FEATURE_CLIENT_PHONE_CONSENT: bool,

    AUTO_ACCEPT_DAYS: z.coerce.number().int().min(1).max(30).default(5),
    CRON_SECRET: optional,
  });

type RawEnv = z.output<typeof base>;
type Checks = {
  env: RawEnv;
  /** Переменная обязательна при условии `when`. */
  require: (key: keyof RawEnv, when: string) => void;
  issue: (key: keyof RawEnv, message: string) => void;
};

/** Секреты в production; без доверенного прокси IP клиента неизвестен — лимиты кодов входа по IP не работают. */
function productionChecks({ env, require, issue }: Checks) {
  if (env.NODE_ENV !== "production") return;
  for (const key of ["PII_ENCRYPTION_KEY", "PII_HASH_KEY", "FILE_URL_SECRET", "CRON_SECRET"] as const) require(key, "NODE_ENV=production");
  if (!env.TRUST_PROXY) issue("TRUST_PROXY", "в production должна быть true: без IP клиента не работают лимиты входа по IP");
}

/** Демо-стенд пускает в любую персону без SMS и умеет стирать базу: в production — только за паролем (src/proxy.ts). */
function demoChecks({ env, require, issue }: Checks) {
  if (env.NODE_ENV === "production" && env.DEMO_MODE) require("DEMO_ACCESS_PASSWORD", "DEMO_MODE=true в production");
  if (env.DEMO_ACCESS_PASSWORD && env.DEMO_ACCESS_PASSWORD.length < 16) {
    issue("DEMO_ACCESS_PASSWORD", "не короче 16 символов: пароль закрывает стенд с данными и сбросом демо");
  }
  // За паролем показа /api/cron/run открыт без пароля (demo-gate) — его закрывает только CRON_SECRET.
  if (env.DEMO_MODE && env.DEMO_ACCESS_PASSWORD) require("CRON_SECRET", "DEMO_MODE=true с паролем показа");
}

/** Вне демо-стенда моки в production означают «код входа никуда не уходит» и «подпись не проверяется». */
function mockChecks({ env, issue }: Checks) {
  if (env.NODE_ENV !== "production" || env.DEMO_MODE) return;
  for (const key of ["SMS_PROVIDER", "SIGNATURE_PROVIDER"] as const) {
    if (env[key] === "mock") issue(key, "mock запрещён в production без DEMO_MODE");
  }
}

function providerChecks({ env, require }: Checks) {
  if (env.SMS_PROVIDER === "http") {
    require("SMS_HTTP_URL", "SMS_PROVIDER=http");
    require("SMS_HTTP_TOKEN", "SMS_PROVIDER=http");
  }
  if (env.STORAGE_PROVIDER === "s3") {
    for (const key of ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) require(key, "STORAGE_PROVIDER=s3");
  }
  if (env.STORAGE_PROVIDER === "vercel-blob") require("BLOB_READ_WRITE_TOKEN", "STORAGE_PROVIDER=vercel-blob");
  if (env.AI_ENABLED && env.AI_PROVIDER === "gateway") {
    for (const key of ["AI_GATEWAY_API_KEY", "AI_TEXT_MODEL", "AI_IMAGE_MODEL"] as const) require(key, "AI_PROVIDER=gateway");
  }
}

function paymentChecks({ env, require }: Checks) {
  // Симулятор банка в production (показ банку): вебхуки подписываются постоянным секретом, а не случайным секретом процесса.
  if (env.NODE_ENV === "production" && (env.PAYMENT_RAIL === "escrow-simulator" || env.DEMO_MODE)) {
    require("ESCROW_SIMULATOR_WEBHOOK_SECRET", "escrow-simulator или DEMO_MODE в production");
  }
  if (env.PAYMENT_RAIL === "bank") {
    require("BANK_API_URL", "PAYMENT_RAIL=bank");
    require("BANK_WEBHOOK_SECRET", "PAYMENT_RAIL=bank");
  }
}

/** prod — пилот с реальными деньгами: никаких моков, демо и песочницы; freedompay — только staging (ADR-009, OPEN_QUESTIONS №41). */
function appEnvChecks({ env, issue }: Checks) {
  if (env.PAYMENT_PROVIDER === "freedompay" && env.APP_ENV !== "staging") {
    issue("PAYMENT_PROVIDER", "freedompay разрешён только при APP_ENV=staging: схема без зачисления на счёт ТОО не подтверждена");
  }
  if (env.APP_ENV !== "prod") return;
  if (env.DEMO_MODE) issue("DEMO_MODE", "запрещён при APP_ENV=prod");
  for (const key of ["SMS_PROVIDER", "SIGNATURE_PROVIDER"] as const) {
    if (env[key] === "mock") issue(key, "mock запрещён при APP_ENV=prod");
  }
  if (env.PAYMENT_PROVIDER === "mock") issue("PAYMENT_PROVIDER", "mock запрещён при APP_ENV=prod");
}

function freedomPayChecks({ env, require }: Checks) {
  if (resolvePaymentProvider(env) !== "freedompay") return;
  for (const key of ["FREEDOMPAY_API_URL", "FREEDOMPAY_MERCHANT_ID", "FREEDOMPAY_SECRET_KEY"] as const) require(key, "PAYMENT_PROVIDER=freedompay");
}

function pushChecks({ env, require }: Checks) {
  if (!env.VAPID_PUBLIC_KEY && !env.VAPID_PRIVATE_KEY) return;
  for (const key of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const) require(key, "задан один из ключей VAPID");
}

/** Провайдер по умолчанию для контура: dev — mock, staging — песочница, prod — ручной режим с банком. */
export const DEFAULT_PAYMENT_PROVIDER = { dev: "mock", staging: "freedompay", prod: "manual" } as const;

export type PaymentProviderName = NonNullable<RawEnv["PAYMENT_PROVIDER"]>;

export function resolvePaymentProvider(env: Pick<RawEnv, "APP_ENV" | "PAYMENT_PROVIDER">): PaymentProviderName {
  return env.PAYMENT_PROVIDER ?? DEFAULT_PAYMENT_PROVIDER[env.APP_ENV];
}

/** Условные обязательные переменные: каждая группа правил — своя функция, порядок сообщений прежний. */
const schema = base.superRefine((env, ctx) => {
  const issue = (key: keyof RawEnv, message: string) => ctx.addIssue({ code: "custom", path: [key], message });
  const checks: Checks = { env, issue, require: (key, when) => !env[key] && issue(key, `обязательна, когда ${when}`) };
  for (const check of [productionChecks, demoChecks, mockChecks, providerChecks, paymentChecks, appEnvChecks, freedomPayChecks, pushChecks]) check(checks);
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Проверка набора переменных; бросает Error со списком всех проблем. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Некорректные переменные окружения:\n${issues}`);
  }
  return parsed.data;
}

/** Переменные окружения, проверенные один раз при первом обращении. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Только для тестов: перечитать окружение после изменения process.env. */
export function resetEnvCache() {
  cached = undefined;
}
