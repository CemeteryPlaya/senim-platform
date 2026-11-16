import { ru } from "@/i18n/ru";
import type { FilterOption } from "../_parts/filters";

const t = ru.app.operatorDisputes.requests;

/** Значение по умолчанию (сутки): параметра в адресе нет. */
export const DEFAULT_HOURS = 24;

/**
 * Варианты фильтра «сколько ждут откликов»: сутки (без параметра в адресе), 3 суток, неделя, месяц. Значение из адреса
 * не из списка (`?hours=5`) — своим чипом в конце, выбранным.
 */
export function hoursOptions(current: number): FilterOption[] {
  const presets = Object.entries(t.presets).map(([hours, label]): FilterOption => ({ value: Number(hours) === DEFAULT_HOURS ? null : hours, label }));
  const known = current === DEFAULT_HOURS || String(current) in t.presets;
  return known ? presets : [...presets, { value: String(current), label: t.custom(current) }];
}
