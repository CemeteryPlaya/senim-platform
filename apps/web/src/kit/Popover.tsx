"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { presence } from "./motion";
import { useOpenState } from "./overlay-state";

/** Имя поповера для диктора: видимый заголовок `title` или, без заголовка, `label` (`aria-label`). */
type PopoverName = { title: string; label?: never } | { label: string; title?: never };

export type PopoverProps = PopoverName & {
  /** Кнопка, открывающая поповер (один элемент); получает `aria-haspopup="dialog"`. */
  trigger: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

/**
 * Поповер у кнопки (компьютер): пояснение, короткий выбор. Растёт из своей кнопки: `transform-origin` — точка
 * триггера, которую считает Radix (`--radix-popover-content-transform-origin`); вход и выход по одному пути,
 * пружина без отскока; при `prefers-reduced-motion` — только проявление.
 *
 * Немодальный: при открытии фокус переходит внутрь, Tab ходит по кругу внутри (FocusScope `loop` Radix ставит
 * всегда), при закрытии фокус возвращается на триггер; Esc и нажатие вне поповера закрывают, и это нажатие
 * сразу срабатывает там, куда нажали. Прокрутка страницы не блокируется. Фон — сплошной `raised`.
 */
export function Popover({ trigger, title, label, open, onOpenChange, children }: PopoverProps) {
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
                className="z-50 w-80 max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin) rounded-card bg-raised p-4 text-body text-ink shadow-float outline-none"
                {...presence(reduced, { scale: 0.9 })}
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
