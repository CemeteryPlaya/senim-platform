import { ru } from "@/i18n/ru";

export type RatingProps = {
  /** Средняя оценка 1…5; `null` — отзывов нет. */
  value: number | null;
  count: number;
};

/** Оценка текстом: «4,8 · 12 отзывов». Без ряда звёзд — число и счёт говорят точнее. Серверный компонент. */
export function Rating({ value, count }: RatingProps) {
  const t = ru.app.kit.rating;
  if (value === null || !(count > 0)) return <p className="text-sub text-muted">{t.none}</p>;
  return <p className="text-sub text-ink">{t.summary(value, count)}</p>;
}
