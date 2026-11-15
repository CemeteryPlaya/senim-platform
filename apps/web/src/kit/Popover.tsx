"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";
import { presence } from "./motion";
import { useOpenState } from "./overlay-state";

/** Имя поповера для диктора: видимый заголовок `title` или, без заголовка, `label` (`aria-label`). */
type PopoverName = { title: string; label?: never } | { label: string; title?: never };

export type PopoverProps = PopoverName & {
  /** Кнопка, открывающая поповер (один элемент); получает `aria-haspopup="dialog"`. */
  trigger: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Материал (разбор 3.4): `solid` (по умолчанию) — сплошной `raised`, для текста пояснений: длинный текст на стекле
   * запрещён; `glass` — толстое стекло `glass-thick`, для короткого выбора (несколько пунктов). Текст на стекле — только
   * ink и glass-secondary.
   */
  material?: "solid" | "glass";
  children?: ReactNode;
};

export const POPOVER_MATERIALS = {
  solid: "bg-raised shadow-overlay",
  glass: "glass-thick",
} as const;

/**
 * Поповер у кнопки (компьютер): пояснение, короткий выбор. Растёт из своей кнопки: `transform-origin` — точка
 * триггера, которую считает Radix (`--radix-popover-content-transform-origin`), масштаб 0,96 → 1 и проявление; вход и
 * выход по одному пути, пружина без отскока; при `prefers-reduced-motion` — только проявление.
 *
 * Немодальный: при открытии фокус переходит внутрь, Tab ходит по кругу внутри (FocusScope `loop` Radix ставит
 * всегда), при закрытии фокус возвращается на триггер; Esc и нажатие вне поповера закрывают, и это нажатие
 * сразу срабатывает там, куда нажали. Прокрутка страницы не блокируется. Фон — сплошной `raised`.
 */
export function Popover({ trigger, title, label, open, onOpenChange, material = "solid", children }: PopoverProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const reduced = useReducedMotion() ?? false;

  return (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={setOpen} modal={false}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <AnimatePresence>
        {isOpen && (
          <PopoverPrimitive.Portal forceMount>
            <PopoverPrimitive.Content
              forceMount
              asChild
              side="bottom"
              align="start"
              sideOffset={8}
              collisionPadding={16}
              aria-label={title ? undefined : label}
            >
              <motion.div
                className={cn(
                  "z-50 w-80 max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin) rounded-card p-4 text-body text-ink outline-none",
                  POPOVER_MATERIALS[material],
                )}
                {...presence(reduced, { scale: 0.96 })}
              >
                {title && <PopoverPrimitive.Title className="mb-1 text-headline text-ink">{title}</PopoverPrimitive.Title>}
                {children}
              </motion.div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        )}
      </AnimatePresence>
    </PopoverPrimitive.Root>
  );
}
