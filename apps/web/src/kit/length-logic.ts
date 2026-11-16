import { ru } from "@/i18n/ru";

/**
 * Длина из текста поля → целые сантиметры (единица, которую ждёт схема заявки). Понимает «240», «240 см», «2,4 м»,
 * «2.4», «2400 мм», «2 400 мм», «2,4м»; единицы по-русски и латиницей, регистр не важен. Без единицы: число с дробной
 * частью до 20 — метры («2.4» → 240), целое больше 2000 — миллиметры («2400» → 240), остальное — сантиметры. Дробные
 * сантиметры округляются («60,5» → 61). Не длина (буквы, два числа, пусто) — `null`.
 */

/** Выше этого целого без единицы число — миллиметры (потолок схемы заявки — 2000 см). */
const MM_ABOVE = 2000;
/** Ниже этого числа с дробной частью без единицы — метры. */
const METERS_BELOW = 20;

const WORDS = ru.app.kit.fields.lengthWords;
const unitOf = (word: string): "mm" | "cm" | "m" | null => {
  const bare = word.replace(/\.$/, "");
  for (const key of ["mm", "cm", "m"] as const) if ((WORDS[key] as readonly string[]).includes(bare)) return key;
  return null;
};

export function parseLengthCm(raw: string): number | null {
  // Пробелы между цифрами («2 400») — разряды, остальные — между числом и единицей.
  const text = raw
    .toLowerCase()
    .replace(/(?<=\d)[\s  ](?=\d)/g, "")
    .replace(",", ".")
    .trim();
  const match = /^(\d+(?:\.\d+)?)\s*(\S*)$/.exec(text);
  if (match === null) return null;
  const value = Number(match[1]);
  const unit = match[2] ?? "";
  if (!Number.isFinite(value)) return null;
  const fractional = match[1]?.includes(".") ?? false;
  let cm: number;
  if (unit === "") {
    // Без единицы — по виду числа: «2.4» метры, «2400» миллиметры, «240» сантиметры.
    if (fractional && value < METERS_BELOW) cm = value * 100;
    else if (!fractional && value > MM_ABOVE) cm = value / 10;
    else cm = value;
  } else {
    const found = unitOf(unit);
    if (found === null) return null;
    cm = found === "mm" ? value / 10 : found === "cm" ? value : value * 100;
  }
  return Math.round(cm);
}

/** Показывать ли под полем «= N см»: набрано не просто целое число сантиметров. */
export function lengthNote(raw: string): number | null {
  const cm = parseLengthCm(raw);
  return cm !== null && raw.trim() !== String(cm) ? cm : null;
}
