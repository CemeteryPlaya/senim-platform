import { ru } from "@/i18n/ru";
import { MAX_PRICE_KZT } from "@/modules/requests/client";
import type { Mask } from "./mask-logic";

/**
 * Поле суммы в целых тенге: чистые функции без React. Показ — разряды через неразрывный пробел («1 200 000»), знак «₸»
 * стоит в поле отдельно. В форму уходят цифры без пробелов — как ждут схемы действий (целые тенге; тиыны считает сервер
 * и `kztToTiyn` из `@/modules/payments/client`).
 */

const NBSP = " ";

/**
 * Предел цифр при вводе — по потолку суммы схем (`MAX_PRICE_KZT` модуля requests, 100 млн ₸ → 9 цифр): лишний разряд
 * не набрать. Сумму выше потолка той же длины («900 000 000») поле пропускает — её отклоняет схема, а `tiynOfDigits`
 * не отдаёт экрану.
 */
export const MONEY_MAX_DIGITS = String(MAX_PRICE_KZT).length;

/**
 * Цифры целых тенге из поля → сумма для экрана в тиынах, только в границах схем (1 … `MAX_PRICE_KZT`): пусто, ноль и
 * сумма выше потолка — `null`. Перевод — `kztToTiyn` модуля денег (передаётся, чтобы правило жило в одном месте).
 */
export function tiynOfDigits(digits: string, kztToTiyn: (kzt: number) => bigint): bigint | null {
  if (digits === "") return null;
  const kzt = Number(digits);
  return kzt >= 1 && kzt <= MAX_PRICE_KZT ? kztToTiyn(kzt) : null;
}

/** Слова после числа (русские — из `ru`, где живут все слова языка): «1,2 млн», «500 тыс», «1.5k». */
const words = ru.app.kit.fields.moneyWords;
const MULTIPLIERS: readonly [readonly string[], number][] = [
  [[...words.billion, "mlrd", "bn", "b"], 9],
  [[...words.million, "mln", "m"], 6],
  [[...words.thousand, "k"], 3],
];

/** Валюта и слова о ней — не часть суммы. */
const CURRENCY = ["₸", ...words.currency, "kzt"];

/** Целая часть числа «a,b» × 10^power — строкой цифр, без float (дробная часть дальше разряда отбрасывается). */
function scaled(whole: string, fraction: string, power: number): string {
  const joined = whole + fraction.padEnd(power, "0").slice(0, power);
  return joined.replace(/^0+(?=\d)/, "");
}

/** Без пробелов, валюты и точки в конце («тыс.»), в нижнем регистре. */
function compactOf(text: string): string {
  let out = text.toLowerCase().replace(/\s/g, "");
  for (const word of CURRENCY) out = out.split(word).join("");
  return out.replace(/\.$/, "");
}

/**
 * Вставленная сумма → цифры целых тенге; `null` — не сумма (тогда поле оставляет только цифры).
 *
 * - «1 200 000», «1 200 000 ₸», «1200000тг» → «1200000»;
 * - «1,2 млн», «1.2 млн», «1,5 тыс», «2 млрд» → «1200000», «1500», «2000000000»;
 * - «1.200.000», «1,200,000» (разряды точкой или запятой) → «1200000»;
 * - «1 200 000,50» (тиыны) → «1200000»: поле — целые тенге.
 */
export function parseMoneyText(text: string): string | null {
  const compact = compactOf(text);
  if (compact === "") return null;
  const withWord = /^(\d+)(?:[.,](\d+))?(\p{L}+)$/u.exec(compact);
  if (withWord) {
    const multiplier = MULTIPLIERS.find(([list]) => list.includes(withWord[3]));
    return multiplier ? scaled(withWord[1], withWord[2] ?? "", multiplier[1]) : null;
  }
  if (/^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/.test(compact)) return compact.replace(/[.,]/g, "");
  const decimal = /^(\d+)[.,]\d{1,2}$/.exec(compact);
  if (decimal) return decimal[1];
  return /^\d+$/.test(compact) ? compact : null;
}

/**
 * Сумма в целых тенге. Ведущие нули срезаются («007» → «7»; одиночный «0» остаётся), буквы, точка и запятая при наборе
 * не вводятся, вставка разбирается `parseMoneyText`.
 */
export const MONEY_MASK: Mask = {
  keep: (raw) => raw.replace(/[^0-9]/g, ""),
  max: MONEY_MAX_DIGITS,
  rejectOverflow: true,
  trim: (sig) => {
    const rest = sig.replace(/^0+(?=\d)/, "");
    return { sig: rest, dropped: sig.length - rest.length };
  },
  format: (sig) => sig.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP),
  paste: parseMoneyText,
};
