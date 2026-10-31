/**
 * Защита подтверждений от двойного нажатия. Первый клик открывает окно, второй (через 100–300 мс)
 * попадает в то же место экрана — уже в окно, часто прямо в «Да». Такой клик — продолжение
 * открытия, а не решение человека.
 */
export const OPENING_GRACE_MS = 500;

/** Клик пришёл в первые OPENING_GRACE_MS после открытия окна (openedAt — performance.now() при открытии). */
export function isOpeningClick(openedAt: number | null, now: number): boolean {
  return openedAt !== null && now - openedAt < OPENING_GRACE_MS;
}

/** Второй и следующие клики одной серии (event.detail > 1). Клавиатура даёт detail = 0. */
export function isRepeatClick(detail: number): boolean {
  return detail > 1;
}
