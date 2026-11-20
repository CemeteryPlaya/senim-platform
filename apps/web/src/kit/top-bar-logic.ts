/**
 * Чистая логика шапки компьютера над фото первого экрана (TopBarOverPhoto, landing.css). Без React — проверяется
 * юнит-тестами.
 *
 * Прогресс `--top-bar-p` (0–1): 0 — шапка прозрачна, текст белый поверх затемнённого фото; 1 — стекло glass-bar с тёмным
 * текстом. Стекло проявляется, как только страница прокручена на 1rem: пока прокрутка меньше, шапка целиком над верхней
 * полосой затемнения фото (высота шапки + 1rem) и белый текст держит ≥ 4,5:1. Обратно — только ниже 0,5rem (гистерезис):
 * у самого порога шапка не мигает туда-обратно. Переход — по времени, а не по прокрутке: в покое шапка всегда в одном из
 * двух читаемых видов, промежуточный вид (контраст ниже 4,5:1) длится только сам переход.
 */

/** Прокрутка, с которой проявляется стекло, — в rem (в пикселях — по размеру шрифта корня). */
export const TOP_BAR_GLASS_FROM_REM = 1;

/** Прокрутка, ниже которой стекло снова уходит, — в rem (меньше порога появления: гистерезис). */
export const TOP_BAR_CLEAR_BELOW_REM = 0.5;

/** Длительность перехода «прозрачная ↔ стекло», мс (как проявление FADE в motion.ts). */
export const TOP_BAR_FADE_MS = 150;

/**
 * Атрибут `<html>`, который до запуска React ставит встроенный скрипт (topBarEarlyScript): есть — стекло. Страница,
 * открытая заново или по «Назад» уже прокрученной, сразу рисует стекло с тёмным текстом, а не белый текст над светлым
 * содержимым.
 */
export const TOP_BAR_GLASS_ATTR = "data-top-bar-glass";

/** Атрибут `<html>`: вид шапки ведёт TopBarOverPhoto, встроенный скрипт больше не нужен и снимает свой обработчик. */
export const TOP_BAR_LIVE_ATTR = "data-top-bar-live";

/**
 * Целевой вид для прокрутки `scrollY` при текущем `current`: 0 — над фото, 1 — стекло. Стекло — с 1rem прокрутки, обратно —
 * ниже 0,5rem; между порогами вид не меняется. `remPx` — размер шрифта корня в пикселях.
 */
export function topBarTarget(scrollY: number, remPx: number, current: 0 | 1): 0 | 1 {
  if (current === 1) return scrollY >= TOP_BAR_CLEAR_BELOW_REM * remPx ? 1 : 0;
  return scrollY >= TOP_BAR_GLASS_FROM_REM * remPx ? 1 : 0;
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

/**
 * Встроенный скрипт первого экрана: выполняется при разборе HTML, до первой отрисовки и до запуска React, и по прокрутке
 * (в том числе восстановленной браузером при перезагрузке) ставит на `<html>` атрибут стекла — те же пороги, что
 * topBarTarget. Когда вид начинает вести TopBarOverPhoto (атрибут «live»), снимает свой обработчик. Без зависимостей;
 * CSP проекта встроенные скрипты не ограничивает (next.config.ts: только frame-ancestors).
 */
export function topBarEarlyScript(): string {
  return [
    "(function(){",
    "var d=document.documentElement,on=d.hasAttribute('" + TOP_BAR_GLASS_ATTR + "');",
    "function u(){",
    "if(d.hasAttribute('" + TOP_BAR_LIVE_ATTR + "')){removeEventListener('scroll',u);return}",
    "var r=parseFloat(getComputedStyle(d).fontSize)||16,y=window.scrollY;",
    "var n=on?y>=" + TOP_BAR_CLEAR_BELOW_REM + "*r:y>=" + TOP_BAR_GLASS_FROM_REM + "*r;",
    "if(n!==on){on=n;d.toggleAttribute('" + TOP_BAR_GLASS_ATTR + "',n)}",
    "}",
    "u();addEventListener('scroll',u,{passive:true})",
    "})()",
  ].join("");
}
