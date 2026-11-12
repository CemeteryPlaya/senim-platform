"use client";

import { useRef, type ReactElement, type ReactNode } from "react";
import { Drawer } from "vaul";
import { ru } from "@/i18n/ru";
import { useOpenState, useReturnFocus } from "./overlay-state";

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
  /**
   * Первый фокус при открытии. По умолчанию — сама шторка (контейнер), а не первое поле: иначе на телефоне
   * клавиатура выезжает одновременно со шторкой. Чтобы поставить фокус на свой элемент — `preventDefault()`
   * и `focus({ preventScroll: true })` в обработчике (без прыжка прокрутки на iOS посреди выезда).
   */
  onOpenAutoFocus?: (event: Event) => void;
  children?: ReactNode;
};

/**
 * Шторка снизу (телефон): пояснения, подтверждения, выбор из списка.
 *
 * Жест — у vaul (решение на Фазу 1, отклонение от спеки зафиксировано в отчёте задачи 6):
 * - есть: шторка тянется за пальцем 1:1; бросок вниз закрывает по скорости или после четверти высоты; вверх
 *   за край — резиновое сопротивление; отпущенная шторка возвращается на место;
 * - нет: схватить шторку посреди открытия нельзя — vaul не даёт тянуть первые 500 мс после открытия;
 *   открытие и закрытие — CSS-keyframes с фиксированной кривой, а не пружина; скорость броска в доезд
 *   не переносится; отскока после броска нет. Длительность открытия и закрытия — 0,4 с (overlays.css).
 *
 * Окно — Radix Dialog внутри vaul: Tab ходит по кругу внутри, фокус возвращается на триггер, Esc и нажатие
 * на затемнение закрывают, прокрутка страницы заблокирована (её держит `Drawer.Overlay`).
 * `prefers-reduced-motion` — проявление вместо выезда (overlays.css); `prefers-reduced-transparency` —
 * затемнение плотнее (утилита `scrim`).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  dismissible = true,
  onOpenAutoFocus,
  children,
}: SheetProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const returnFocus = useReturnFocus(isOpen, trigger === undefined);
  const content = useRef<HTMLDivElement>(null);

  return (
    <Drawer.Root open={isOpen} onOpenChange={setOpen} dismissible={dismissible} autoFocus>
      {trigger && <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>}
      <Drawer.Portal>
        <Drawer.Overlay className="scrim fixed inset-0 z-40" />
        <Drawer.Content
          ref={content}
          onOpenAutoFocus={(event) => {
            onOpenAutoFocus?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            content.current?.focus({ preventScroll: true });
          }}
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
