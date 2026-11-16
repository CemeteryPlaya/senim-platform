import type { ChipItem } from "@/kit";
import { pageHref } from "../../../_shell/auth";

/** Значение фильтра и подпись чипа; `value: null` — «Все» (параметра в адресе нет). */
export type FilterOption = { value: string | null; label: string };

/** Параметры страницы, которые сбрасываются при смене фильтра: курсор и номер страницы (с новым фильтром — с начала). */
const RESET = ["before", "page"] as const;

/**
 * Чипы фильтра в адресе для экранов оператора (`Chips` из kit): каждый чип — ссылка на этот же экран с параметром `key`
 * = значение варианта (у «Все» параметра нет); остальные параметры адреса сохраняются, курсор и страница сбрасываются.
 * Выбранный — вариант с текущим значением параметра; неизвестное значение — выбран «Все» (если он есть). `screen` — путь
 * экрана без префикса v2 (`"/operator/executors"`), `params` — searchParams страницы. Работает без JavaScript, с «Назад»
 * и общей ссылкой.
 */
export function filterChips(
  screen: string,
  params: Readonly<Record<string, string | string[] | undefined>>,
  key: string,
  options: readonly FilterOption[],
): ChipItem[] {
  const raw = params[key];
  const current = typeof raw === "string" ? raw : null;
  const known = options.some((option) => option.value === current);
  const base = Object.fromEntries(Object.entries(params).filter(([name]) => name !== key && !(RESET as readonly string[]).includes(name)));
  return options.map((option) => ({
    href: pageHref(screen, option.value === null ? base : { ...base, [key]: option.value }),
    label: option.label,
    active: known ? option.value === current : option.value === null,
  }));
}
