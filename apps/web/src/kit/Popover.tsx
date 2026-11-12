"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useId, type ReactElement, type ReactNode } from "react";
import { presence } from "./motion";
import { useOpenState } from "./overlay-state";

export type PopoverProps = {
  /** Кнопка, открывающая поповер (один элемент); получает `aria-haspopup="dialog"`. */
  trigger: ReactElement;
  title?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

/**
 * Поповер у кнопки (компьютер): пояснение, короткий выбор. Растёт из своей кнопки: `transform-origin` — точка
 * триггера, которую считает Radix (`--radix-popover-content-transform-origin`); вход и выход по одному пути,
 * пружина без отскока; при `prefers-reduced-motion` — только проявление.
 *
 * Модальный: фокус заперт внутри и возвращается на триггер, Esc и нажатие вне поповера закрывают,
 * прокрутка страницы на это время заблокирована. Фон — сплошной `raised`, полупрозрачности нет.
 */
export function Popover({ trigger, title, open, onOpenChange, children }: PopoverProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const reduced = useReducedMotion() ?? false;
  const titleId = useId();

  return (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={setOpen} modal>
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
              aria-labelledby={title ? titleId : undefined}
            >
              <motion.div
                className="z-50 w-80 max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin) rounded-card bg-raised p-4 text-body text-ink shadow-float outline-none"
                {...presence(reduced, { scale: 0.9 })}
              >
                {title && (
                  <p id={titleId} className="mb-1 text-card text-ink">
                    {title}
                  </p>
                )}
                {children}
              </motion.div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        )}
      </AnimatePresence>
    </PopoverPrimitive.Root>
  );
}
