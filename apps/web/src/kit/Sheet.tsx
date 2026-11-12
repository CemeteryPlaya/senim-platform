"use client";

import type { ReactElement, ReactNode } from "react";
import { Drawer } from "vaul";
import { ru } from "@/i18n/ru";
import { useOpenState, useReturnFocus, withoutDescription } from "./overlay-state";

export type SheetProps = {
  /** Открыта ли шторка. Без `open` шторка управляется сама и открывается триггером. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  /** Кнопка, открывающая шторку (один элемент: `Button` или `<button>`); получает `aria-haspopup="dialog"`. */
  trigger?: ReactElement;
  /** `false` — шторку нельзя закрыть жестом, затемнением и Esc (например, пока идёт действие). */
  dismissible?: boolean;
  children?: ReactNode;
};

/**
 * Шторка снизу (телефон): пояснения, подтверждения, выбор из списка.
 *
 * Жест — у vaul: шторка тянется за пальцем 1:1, её можно схватить посреди анимации, бросок вниз закрывает
 * по скорости, вверх за край — резиновое сопротивление. Окно — Radix Dialog внутри vaul: фокус заперт внутри
 * и возвращается на триггер, Esc и нажатие на затемнение закрывают, прокрутка страницы заблокирована
 * (её держит `Drawer.Overlay`). `prefers-reduced-motion` и `prefers-reduced-transparency` — в overlays.css
 * (проявление вместо выезда) и в утилите `scrim` (сплошное затемнение).
 */
export function Sheet({ open, onOpenChange, title, description, trigger, dismissible = true, children }: SheetProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const returnFocus = useReturnFocus(isOpen, trigger === undefined);

  return (
    <Drawer.Root open={isOpen} onOpenChange={setOpen} dismissible={dismissible} autoFocus>
      {trigger && <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>}
      <Drawer.Portal>
        <Drawer.Overlay className="scrim fixed inset-0 z-40" />
        <Drawer.Content
          {...withoutDescription(description)}
          onCloseAutoFocus={returnFocus}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-11/12 w-full max-w-column flex-col rounded-t-sheet bg-raised px-5 pt-3 pb-sheet text-body text-ink shadow-sheet outline-none"
        >
          {/* Ручка — знак «можно смахнуть»; тянуть можно за любое место шторки. */}
          <div aria-hidden className="mx-auto mb-4 h-1.5 w-9 shrink-0 rounded-full bg-muted/50" />
          <Drawer.Title className="text-section text-ink">{title}</Drawer.Title>
          {description && <Drawer.Description className="mt-2 text-body text-muted">{description}</Drawer.Description>}
          {/* Прокрутка длинного содержимого; поле в 4 px (p-1, -mx-1), чтобы кольцо фокуса кнопок не обрезалось. */}
          <div className="-mx-1 mt-3 min-h-0 overflow-y-auto p-1">{children}</div>
          {/* Для диктора и клавиатуры; видна только в фокусе с клавиатуры. Esc закрывает так же. */}
          {dismissible && (
            <Drawer.Close className="sr-only rounded-control px-4 text-sub text-ink focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:right-3 focus-visible:min-h-control focus-visible:bg-line">
              {ru.app.kit.close}
            </Drawer.Close>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
