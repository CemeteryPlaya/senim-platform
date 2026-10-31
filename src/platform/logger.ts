type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Значение не попадает в лог, если имя ключа содержит одно из этих слов (без учёта регистра):
// clientPhone, binIinEnc, messageText — тоже. Лучше скрыть лишнее, чем выдать ИИН или текст чата.
const SECRET_KEY_PARTS = [
  "iin",
  "bin",
  "phone",
  "code",
  "otp",
  "token",
  "password",
  "secret",
  "authorization",
  "cookie",
  "signature",
  "text",
  "body",
  "fullname",
  "address",
  "legalname",
  "comment",
  "report",
  "description",
  "position",
];
const SECRET_KEY = new RegExp(SECRET_KEY_PARTS.join("|"), "i");

// В тексте ошибки: 12 цифр подряд (ИИН/БИН) и телефоны (+7 700 123 45 67, 8(700)123-45-67, 87001234567).
const SENSITIVE_IN_TEXT = [/(?<!\d)\d{12}(?!\d)/g, /(?<![\d+])(?:\+\s?\d{1,3}|[78])[\s\-()]*\d{3}[\s\-()]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g];
const maskText = (text: string) => SENSITIVE_IN_TEXT.reduce((t, re) => t.replace(re, "[скрыто]"), text);

/** Ошибки Prisma несут в message аргументы запроса (ИИН, телефон, тексты) — их не пишем вовсе. */
const PRISMA_ERRORS_WITH_ARGS = new Set(["PrismaClientKnownRequestError", "PrismaClientValidationError"]);

/** Только строки стека «at …»: первая строка стека повторяет message. */
const stackFrames = (stack: string | undefined) => stack?.split("\n").filter((l) => /^\s+at\s/.test(l)).join("\n");

function errorFields(error: Error): Record<string, unknown> {
  if (PRISMA_ERRORS_WITH_ARGS.has(error.name)) {
    const { code, meta } = error as Error & { code?: unknown; meta?: { target?: unknown } };
    return { name: error.name, code, target: meta?.target, stack: stackFrames(error.stack) };
  }
  return { name: error.name, message: maskText(error.message), stack: error.stack && maskText(error.stack) };
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return errorFields(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[скрыто]" : redact(v, depth + 1)]),
  );
}

function minLevel(): Level {
  const v = process.env.LOG_LEVEL;
  return v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";
}

function write(level: Level, msg: string, fields: Record<string, unknown>) {
  if (order[level] < order[minLevel()]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(redact(fields) as object) });
  // Единственное место в коде, где разрешён вывод в консоль.
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(line);
}

export type Logger = {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
};

function make(bound: Record<string, unknown>): Logger {
  return {
    debug: (m, f) => write("debug", m, { ...bound, ...f }),
    info: (m, f) => write("info", m, { ...bound, ...f }),
    warn: (m, f) => write("warn", m, { ...bound, ...f }),
    error: (m, f) => write("error", m, { ...bound, ...f }),
    child: (f) => make({ ...bound, ...f }),
  };
}

export const logger: Logger = make({});
