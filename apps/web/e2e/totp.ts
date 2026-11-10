import { createHmac } from "node:crypto";

/**
 * TOTP по RFC 6238 поверх HOTP (RFC 4226), HMAC-SHA1, шесть цифр, шаг 30 с — как totp.go в identity и как
 * приложения-аутентификаторы. Для e2e (код из секрета со страницы) и подделки identity в тестах web.
 */
export const TOTP_PERIOD_S = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** base32 без «=» (пробелы и регистр не важны: секрет на экране разбит на группы) → байты. */
export function fromBase32(text: string): Buffer {
  const clean = text.replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("секрет TOTP не base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Байты → base32 без «=» (как totpBase32 в Go). */
export function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Номер шага для момента времени. */
export function totpStep(at: Date | number = Date.now()): number {
  return Math.floor((typeof at === "number" ? at : at.getTime()) / 1000 / TOTP_PERIOD_S);
}

/** Код шага `step`: шесть цифр с ведущими нулями. */
export function totpCode(secret: Uint8Array, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const sum = createHmac("sha1", secret).update(msg).digest();
  const off = sum[sum.length - 1]! & 0x0f;
  const bin = sum.readUInt32BE(off) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Код на момент `at` по секрету в base32 — как его показало бы приложение. */
export function totpNow(secretBase32: string, at: Date | number = Date.now()): string {
  return totpCode(fromBase32(secretBase32), totpStep(at));
}
