/** Целых секунд до `until` (миллисекунды Unix) в момент `now`, округление вверх; срок прошёл — 0. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
