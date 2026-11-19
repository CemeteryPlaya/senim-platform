/**
 * Чистая логика шапки компьютера над фото первого экрана (TopBarOverPhoto, landing.css). Без React — проверяется
 * юнит-тестами.
 *
 * Прогресс `--top-bar-p` (0–1): 0 — шапка прозрачна, текст белый поверх затемнённого фото; 1 — стекло glass-bar с тёмным
 * текстом. Стекло проявляется, как только страница прокручена на 1rem: пока прокрутка меньше, шапка целиком над верхней
 * полосой затемнения фото (высота шапки + 1rem) и белый текст держит ≥ 4,5:1. Переход — по времени, а не по прокрутке:
 * в покое шапка всегда в одном из двух читаемых видов, промежуточный вид (контраст ниже 4,5:1) длится только сам переход.
 */

/** Прокрутка, с которой проявляется стекло, — в rem (в пикселях — по размеру шрифта корня). */
export const TOP_BAR_GLASS_FROM_REM = 1;

/** Длительность перехода «прозрачная ↔ стекло», мс (как проявление FADE в motion.ts). */
export const TOP_BAR_FADE_MS = 150;

/** Целевой вид для прокрутки `scrollY`: 0 — над фото, 1 — стекло. */
export function topBarTarget(scrollY: number, glassFromPx: number): 0 | 1 {
  return scrollY >= glassFromPx ? 1 : 0;
}

/**
 * Прогресс перехода от `from` к `to` через `elapsedMs` после начала. Кривая — плавная в начале и в конце (smootherstep):
 * середина, где ни белый, ни тёмный текст не держит контраст, проходится быстрее. Меньше движения (`reduce`) — сразу `to`.
 */
export function topBarFade(from: number, to: number, elapsedMs: number, reduce: boolean, durationMs = TOP_BAR_FADE_MS): number {
  if (reduce || durationMs <= 0) return to;
  const k = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const eased = k * k * k * (k * (6 * k - 15) + 10);
  return from + (to - from) * eased;
}
