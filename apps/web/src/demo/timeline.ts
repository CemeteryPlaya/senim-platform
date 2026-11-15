import { THIS_MONTH_SPAN_DAYS, type When } from "./data";

/**
 * Время плана сида («дней назад», `thisMonth`) → момент; чистая функция часов сида (retime.ts, тесты плана).
 *
 * Дни плана ложатся на рабочие часы Астаны (10:00–19:00): «22,3 дня назад» — 22 дня назад около 16:20, а не в час засева
 * (иначе у всех действий одно и то же время суток, например 01:01). Отсчёт идёт от последнего рабочего момента не позже
 * «сейчас», поэтому порядок шагов сохраняется и всё остаётся в прошлом.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ASTANA_UTC_OFFSET_MS = 5 * HOUR;
const OPEN_H = 10;
const SPAN_H = 9;

/** Полночь по Астане (UTC+5) дня момента `t`, в мс UTC. */
const astanaMidnight = (t: number) => Math.floor((t + ASTANA_UTC_OFFSET_MS) / DAY) * DAY - ASTANA_UTC_OFFSET_MS;

/** Начало текущего месяца по времени Астаны (UTC+5), в мс UTC. */
export function monthStartAstana(now: number): number {
  const local = new Date(now + ASTANA_UTC_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - ASTANA_UTC_OFFSET_MS;
}

/** Последний рабочий момент не позже `now`: сам `now` днём, 19:00 вечером, вчерашние 19:00 до открытия. */
function lastBusinessMoment(now: number): number {
  const midnight = astanaMidnight(now);
  const open = midnight + OPEN_H * HOUR;
  const close = open + SPAN_H * HOUR;
  if (now < open) return close - DAY;
  return Math.min(now, close);
}

/** `days` дней назад в рабочих часах: каждый день плана — календарный день, доля дня — доля рабочего окна. */
function businessTime(days: number, now: number): number {
  const b = lastBusinessMoment(now);
  const bDay = astanaMidnight(b);
  const x = (b - bDay - OPEN_H * HOUR) / (SPAN_H * HOUR) - days;
  const offset = Math.floor(x);
  return bDay + offset * DAY + OPEN_H * HOUR + (x - offset) * SPAN_H * HOUR;
}

/** Момент по плану; `thisMonth` в первые дни месяца сжимается пропорционально и не выходит за начало месяца. */
export function resolveWhen(when: When, now: number): number {
  if (typeof when === "number") return businessTime(when, now);
  const monthStart = monthStartAstana(now);
  const days = when.thisMonth * Math.min(1, (now - monthStart) / DAY / THIS_MONTH_SPAN_DAYS);
  const t = businessTime(days, now);
  return t >= monthStart ? t : now - days * DAY;
}
