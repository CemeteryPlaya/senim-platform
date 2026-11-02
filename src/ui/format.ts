import { ru } from "@/i18n/ru";

/** Все даты показываем по времени Астаны (с 2024 года — UTC+5, зона Asia/Almaty). */
export const TIME_ZONE = "Asia/Almaty";
const LOCALE = "ru-RU";
const NBSP = " ";

const moneyFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, useGrouping: true });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE });
const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

export type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Сумма в тенге: «1 250 000 ₸» (пробелы неразрывные — сумма не переносится). */
export function formatMoney(amount: number): string {
  const grouped = moneyFormat.format(Math.round(amount)).replace(/\s/g, NBSP);
  return `${grouped}${NBSP}${ru.common.currency}`;
}

/**
 * Сумма в тиынах (деньги сделки, ADR-009): «1 530 000 ₸», с тиынами — «101,05 ₸».
 * bigint, чтобы не терять точность; тиыны показываются, только если они есть.
 */
export function formatTiyn(tiyn: bigint): string {
  const sign = tiyn < 0n ? "−" : "";
  const abs = tiyn < 0n ? -tiyn : tiyn;
  const whole = moneyFormat.format(abs / 100n).replace(/\s/g, NBSP);
  const cents = abs % 100n;
  const fraction = cents === 0n ? "" : `,${cents.toString().padStart(2, "0")}`;
  return `${sign}${whole}${fraction}${NBSP}${ru.common.currency}`;
}

/**
 * Сумма по кускам, между которыми допустим перенос: после каждой группы разрядов.
 * На узком экране при крупном шрифте «10 005 000 ₸» встаёт в две строки, а не уходит за край;
 * знак валюты не отрывается от последней группы. bigint — деньги сделки в тиынах (formatTiyn).
 */
export function moneyBreakParts(amount: number | bigint): string[] {
  const text = typeof amount === "bigint" ? formatTiyn(amount) : formatMoney(amount);
  return text.split(/(?<=\d\u00a0)(?=\d)/u);
}

/** «12 марта 2026». */
export function formatDate(value: DateInput): string {
  // Intl добавляет « г.» после года — в интерфейсе он лишний.
  return dateFormat.format(toDate(value)).replace(/\s*г\.$/, "");
}

/** «14:30». */
export function formatTime(value: DateInput): string {
  return timeFormat.format(toDate(value));
}

/** «12 марта 2026, 14:30». */
export function formatDateTime(value: DateInput): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** «сейчас», «5 минут назад», «вчера», «через 3 дня»; дальше недели — обычная дата. */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const diff = toDate(value).getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < MINUTE) return relativeFormat.format(0, "second");
  if (abs < HOUR) return relativeFormat.format(Math.trunc(diff / MINUTE), "minute");
  if (abs < DAY) return relativeFormat.format(Math.trunc(diff / HOUR), "hour");
  if (abs < WEEK) return relativeFormat.format(Math.trunc(diff / DAY), "day");
  return formatDate(value);
}

const pluralRules = new Intl.PluralRules(LOCALE);
type Unit = keyof typeof ru.common.units;

/** «35 дней», «21 день», «3 дня»: число и полное слово в нужной форме, без переноса между ними. */
function formatCount(n: number, unit: Unit): string {
  const [one, few, many] = ru.common.units[unit];
  const rule = pluralRules.select(n);
  const word = rule === "one" ? one : rule === "few" ? few : many;
  return `${n}${NBSP}${word}`;
}

/** Срок в днях: «35 дней». */
export const formatDays = (n: number): string => formatCount(n, "days");
/** Срок в месяцах: «18 месяцев». */
export const formatMonths = (n: number): string => formatCount(n, "months");
/** Годы: «12 лет». */
export const formatYears = (n: number): string => formatCount(n, "years");
