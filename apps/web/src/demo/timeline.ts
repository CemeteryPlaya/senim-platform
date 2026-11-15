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

/** Доля рабочего окна, которую задаёт сама дата (иначе целые дни плана все попадали бы на одно и то же время суток). */
const DATE_SHARE = 0.8;
const dateJitter = (dayStart: number) => ((Math.round(dayStart / DAY) * 0.618_033_988_7) % 1 + 1) % 1;

/**
 * `days` дней назад в рабочих часах: каждый день плана — календарный день. Внутри прошедших дней время суток задаёт дата
 * (DATE_SHARE окна) и доля дня плана (остаток окна) — порядок шагов одного дня сохраняется; сегодня — только доля дня
 * плана, чтобы не уйти позже «сейчас».
 */
function businessTime(days: number, now: number): number {
  const b = lastBusinessMoment(now);
  const bDay = astanaMidnight(b);
  const x = (b - bDay - OPEN_H * HOUR) / (SPAN_H * HOUR) - days;
  const offset = Math.floor(x);
  const day = bDay + offset * DAY;
  const position = offset < 0 ? (1 - DATE_SHARE) * (x - offset) + DATE_SHARE * dateJitter(day) : x - offset;
  return day + OPEN_H * HOUR + position * SPAN_H * HOUR;
}

/** Момент по плану; `thisMonth` в первые дни месяца сжимается пропорционально и не выходит за начало месяца. */
export function resolveWhen(when: When, now: number): number {
  if (typeof when === "number") return businessTime(when, now);
  const monthStart = monthStartAstana(now);
  const days = when.thisMonth * Math.min(1, (now - monthStart) / DAY / THIS_MONTH_SPAN_DAYS);
  const t = businessTime(days, now);
  return t >= monthStart ? t : now - days * DAY;
}
