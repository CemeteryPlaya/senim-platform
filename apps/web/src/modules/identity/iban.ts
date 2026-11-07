import { z } from "zod";
import { ru } from "@/i18n/ru";

/**
 * Казахстанский IBAN (ISO 13616): «KZ», 2 контрольные цифры и 16 символов (3 — код банка, 13 — счёт),
 * всего 20. Контроль — mod-97: первые 4 символа переносятся в конец, буквы заменяются числами
 * (A = 10 … Z = 35), остаток от деления на 97 должен быть 1.
 */
const FORMAT = /^KZ\d{2}[A-Z0-9]{16}$/;

export type IbanCheck = { ok: true; iban: string } | { ok: false; reason: "format" | "checksum" };

/** Как вводят из банковского приложения: группы по 4 через пробел (в том числе неразрывный), строчные буквы. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s/g, "").toUpperCase();
}

/** Остаток mod-97 по частям: число из 40+ цифр не помещается в Number, BigInt не нужен. */
function mod97(digits: string): number {
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
  return rest;
}

export function parseKzIban(raw: string): IbanCheck {
  const iban = normalizeIban(raw);
  if (!FORMAT.test(iban)) return { ok: false, reason: "format" };
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = [...rearranged].map((ch) => (ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch)).join("");
  return mod97(digits) === 1 ? { ok: true, iban } : { ok: false, reason: "checksum" };
}

const t = ru.identity.payout.errors;

/** Поле формы: на выходе — нормализованный верный IBAN. */
export const ibanField = z.string().transform((raw, ctx) => {
  const check = parseKzIban(raw);
  if (check.ok) return check.iban;
  ctx.addIssue({ code: "custom", message: t[check.reason] });
  return z.NEVER;
});
