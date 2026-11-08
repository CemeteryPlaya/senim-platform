import { z } from "zod";
import type { MonthKey, MonthEarnings } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";

const t = ru.executor.finance;

/** Месяцев в столбиках «Финансов»: выбранный и пять до него. */
export const CHART_MONTHS = 6;

/** Первый год, с которого месяц в адресе имеет смысл: раньше выплат быть не может («0050-01» — опечатка или подбор). */
export const FIRST_YEAR = 2000;

const monthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((v) => Number(v.slice(0, 4)) >= FIRST_YEAR);

const parts = (key: MonthKey): [number, number] => key.split("-").map(Number) as [number, number];

export function shiftMonth(key: MonthKey, by: number): MonthKey {
  const [year, month] = parts(key);
  const d = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Месяц из адреса (?month=YYYY-MM). Неверное значение, год раньше FIRST_YEAR и будущий месяц — текущий: выплат из будущего нет.
 * Ключи одной длины сравниваются как строки.
 */
export function selectedMonth(param: unknown, current: MonthKey): MonthKey {
  const parsed = monthParam.safeParse(param);
  if (!parsed.success) return current;
  const key = parsed.data as MonthKey;
  return key > current ? current : key;
}

/** Окно столбиков: CHART_MONTHS месяцев, последний — выбранный; у месяца без выплат — 0. */
export function chartWindow(months: readonly MonthEarnings[], selected: MonthKey): { month: MonthKey; receivedTiyn: bigint }[] {
  return Array.from({ length: CHART_MONTHS }, (_, i) => {
    const month = shiftMonth(selected, i - (CHART_MONTHS - 1));
    return { month, receivedTiyn: months.find((m) => m.month === month)?.receivedTiyn ?? 0n };
  });
}

/** Высота столбика в процентах от самого высокого в окне; пустое окно — все по нулям. */
export function barPercent(value: bigint, max: bigint): number {
  return max === 0n ? 0 : Number((value * 100n) / max);
}

/**
 * Сравнение с прошлым месяцем: «+18% к октябрю» (целые проценты, отбрасывая дробь). В прошлом месяце выплат не было —
 * сравнивать не с чем, null.
 */
export function versusPrevious(current: bigint, previous: bigint, previousMonth: MonthKey): string | null {
  if (previous === 0n) return null;
  const percent = ((current - previous) * 100n) / previous;
  return t.vsPrev(percent, t.monthsTo[parts(previousMonth)[1] - 1]!);
}

/** «ноябрь». */
export function monthName(key: MonthKey): string {
  return t.months[parts(key)[1] - 1]!;
}

/** «Ноябрь 2026» — заголовок месяца. */
export function monthTitle(key: MonthKey): string {
  const name = monthName(key);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${parts(key)[0]}`;
}
