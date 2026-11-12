import type { Transition } from "motion/react";

/**
 * Движение окон kit (спека редизайна, раздел 4 «Движение»; docs/design/v3/rules.md).
 *
 * Пружины задаются длительностью и отскоком: так их проще сравнивать на глаз, чем жёсткость и массу.
 * По умолчанию отскока нет (критическое затухание) — окно встаёт на место без «дрожи». Отскок — только
 * после броска пальцем, когда у движения есть скорость, которую надо погасить.
 */
export const SPRING = {
  default: { type: "spring", bounce: 0, duration: 0.35 },
  flick: { type: "spring", bounce: 0.2, duration: 0.4 },
} as const satisfies Record<string, Transition>;

/** Меньше движения (`prefers-reduced-motion`): короткое проявление вместо пружины и сдвига. */
export const FADE = { type: "tween", ease: "easeOut", duration: 0.15 } as const satisfies Transition;

type Hidden = { scale?: number; y?: number };

/**
 * Свойства motion-элемента окна: вход и выход по одному пути (`exit` совпадает с `initial`), анимируются
 * только `opacity` и `transform`. При `reduced` — только прозрачность, без масштаба и сдвига.
 */
export function presence(reduced: boolean, hidden: Hidden) {
  const from = reduced ? { opacity: 0 } : { opacity: 0, ...hidden };
  return {
    initial: from,
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: from,
    transition: reduced ? FADE : SPRING.default,
  };
}
