import { THIS_MONTH_SPAN_DAYS, type When } from "./data";

/** Время плана сида («дней назад», `thisMonth`) → момент; чистая функция часов сида (retime.ts, тесты плана). */

const DAY = 86_400_000;
const ASTANA_UTC_OFFSET_MS = 5 * 3_600_000;

/** Начало текущего месяца по времени Астаны (UTC+5), в мс UTC. */
export function monthStartAstana(now: number): number {
  const local = new Date(now + ASTANA_UTC_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - ASTANA_UTC_OFFSET_MS;
}

/** Момент «дней назад» по плану; `thisMonth` в первые дни месяца сжимается пропорционально и остаётся внутри месяца. */
export function resolveWhen(when: When, now: number): number {
  if (typeof when === "number") return now - when * DAY;
  const elapsedDays = (now - monthStartAstana(now)) / DAY;
  return now - when.thisMonth * Math.min(1, elapsedDays / THIS_MONTH_SPAN_DAYS) * DAY;
}
