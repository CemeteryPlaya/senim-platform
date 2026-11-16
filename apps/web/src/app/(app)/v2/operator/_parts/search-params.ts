/** Параметры адреса страницы, как их отдаёт Next. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** Все параметры строки запроса как плоский объект для zod-схемы: повтор параметра — первое значение. */
export function flatParams(params: SearchParams): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

/** С первого числа месяца по сегодня по Астане (`YYYY-MM-DD`): период дохода по умолчанию — текущий месяц. */
export function thisMonth(now: Date = new Date()): { from: string; to: string } {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty" }).format(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}
