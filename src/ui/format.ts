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
