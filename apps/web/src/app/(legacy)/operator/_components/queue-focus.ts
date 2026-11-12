/**
 * После решения карточка уходит из очереди: фокус — на карточку, вставшую на её место, а если решена
 * последняя — на новую последнюю. Очередь опустела — null: фокус на заголовок пустого состояния.
 */
export function nextQueueFocus(decidedIndex: number, remaining: number): number | null {
  if (remaining <= 0) return null;
  return Math.min(Math.max(decidedIndex, 0), remaining - 1);
}
