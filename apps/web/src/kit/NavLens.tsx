"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "./cn";
import { SPRING } from "./motion";

export type NavLensProps = {
  /**
   * Имя линзы: одно на группу (панель вкладок, меню разделов). При смене активного пункта линза с тем же именем
   * переезжает из старого пункта в новый (Motion `layoutId`), а не исчезает и появляется.
   */
  group: string;
  /** Форма: капсула (по умолчанию) или скругление поля — когда пункты переносятся в несколько строк. */
  shape?: "capsule" | "field";
};

/**
 * «Линза» активного пункта навигации (разбор 3.6, 3.7; Liquid Glass): подложка `fill-strong` за иконкой и подписью.
 * Кладётся первым ребёнком позиционированного пункта (`relative isolate`), сама — под содержимым (`-z-10`). Переезжает
 * пружиной без отскока (`SPRING.default`: 0,35 с); при `prefers-reduced-motion` — мгновенно. Активный пункт отличается
 * не только весом подписи: подложкой и цветом. Скрыта от диктора — активный пункт объявляет `aria-current`.
 */
export function NavLens({ group, shape = "capsule" }: NavLensProps) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.span
      aria-hidden
      data-nav-lens
      layoutId={`nav-lens-${group}`}
      transition={reduced ? { duration: 0 } : SPRING.default}
      className={cn("absolute inset-0 -z-10 bg-fill-strong", shape === "capsule" ? "rounded-chip" : "rounded-field")}
    />
  );
}
