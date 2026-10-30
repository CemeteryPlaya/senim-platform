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

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
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
