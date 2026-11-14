/** Чистая логика `Bars`: высота столбика в процентах от самого высокого. Без React — проверяется юнит-тестами. */

/**
 * Процент 0–100 от максимума в окне; целые тиыны (`bigint`), ни одного float. Пустое окно (максимум 0) и ноль — 0.
 * Ненулевое значение не меньше 4%, иначе малая сумма рядом с большой выглядит как ноль.
 */
export function barPercents(values: readonly bigint[]): number[] {
  const max = values.reduce((a, b) => (b > a ? b : a), 0n);
  if (max <= 0n) return values.map(() => 0);
  return values.map((value) => {
    if (value <= 0n) return 0;
    const percent = Number((value * 100n) / max);
    return Math.max(4, percent);
  });
}
