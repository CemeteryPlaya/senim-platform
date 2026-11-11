import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// Ключи для разработки и тестов. В production env.ts требует настоящие ключи.
const DEV_ENC_KEY = createHash("sha256").update("senim-dev-pii-encryption").digest();
const DEV_HASH_KEY = createHash("sha256").update("senim-dev-pii-hash").digest();

function encKey() {
  const k = env().PII_ENCRYPTION_KEY;
  return k ? Buffer.from(k, "base64") : DEV_ENC_KEY;
}

function hashKey() {
  const k = env().PII_HASH_KEY;
  return k ? Buffer.from(k, "base64") : DEV_HASH_KEY;
}

/** AES-256-GCM. Формат: v1.<iv>.<tag>.<ciphertext>, части в base64url. */
export function encryptPii(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptPii(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Неизвестный формат зашифрованных данных");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Ключ запечатывания значений, которые сервер отдаёт наружу и получает обратно: выводится из ключа ПДн, но им не является. */
function sealKey() {
  return createHmac("sha256", encKey()).update("senim-seal-v1").digest();
}

/**
 * Запечатать короткоживущее значение, которое уходит за пределы сервера и возвращается (sessionId подписи mock-ЭЦП):
 * AES-256-GCM, `context` — AAD (значение одного назначения не открывается в другом). Не для хранения ПДн в базе.
 * Формат: s1.<iv>.<tag>.<ciphertext>, части в base64url.
 */
export function sealValue(plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["s1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Открыть значение sealValue с тем же `context`; подделка, чужой контекст или формат — исключение. */
export function openValue(sealed: string, context: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "s1" || !iv || !tag || !data) throw new Error("Неизвестный формат запечатанного значения");
  const decipher = createDecipheriv("aes-256-gcm", sealKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Детерминированный HMAC для поиска и уникальности без расшифровки. */
export function hashPii(plain: string): string {
  return createHmac("sha256", hashKey()).update(plain).digest("hex");
}

export function last4(plain: string): string {
  return plain.slice(-4);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacHex(secret: string | Buffer, data: string | Uint8Array): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Сравнение строк за постоянное время (секреты, подписи). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
