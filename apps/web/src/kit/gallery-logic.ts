/**
 * Чистая логика галереи на весь экран и мозаики (без React и браузера): соседний снимок по кругу, жест «смахнуть»,
 * раскладка мозаики по числу снимков. Проверяет её photo.test.tsx.
 */

/** Индекс соседнего снимка: по кругу (после последнего — первый). Пустой список — 0. */
export function stepIndex(index: number, delta: -1 | 1, total: number): number {
  if (total <= 0) return 0;
  return (index + delta + total) % total;
}

/** Порог жеста: дальше 48 px по горизонтали и заметно больше, чем по вертикали (вертикальная прокрутка — не жест). */
const SWIPE_DISTANCE = 48;
const SWIPE_RATIO = 1.5;

/** Куда смахнули: `1` — вперёд (палец влево), `-1` — назад (палец вправо), `0` — не жест. */
export function swipeDelta(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}

/** Раскладка мозаики: `one` — один большой, `two` — два равных, `three` — один большой и два малых (остальные — в галерее). */
export type MosaicShape = "one" | "two" | "three";

export function mosaicShape(total: number): MosaicShape | null {
  if (total <= 0) return null;
  return total === 1 ? "one" : total === 2 ? "two" : "three";
}
