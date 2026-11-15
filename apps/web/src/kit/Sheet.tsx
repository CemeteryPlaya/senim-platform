"use client";

import { useRef, type ReactElement, type ReactNode, type RefObject } from "react";
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
  /**
   * Куда вернуть фокус при закрытии окна, открытого без `trigger` (программно, например из пункта `Menu`): к моменту
   * закрытия запомнить нечего, фокус ушёл бы на `<body>`. Для окна из меню — ссылка на кнопку меню (`triggerRef`).
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
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
  returnFocusTo,
  children,
}: SheetProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const returnFocus = useReturnFocus(isOpen, trigger === undefined, returnFocusTo);
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
          // px-5 (20 px) — мимо шкалы намеренно: поля шторки эталона mobile.html — 18 px; 16 px со шкалы прижимают
          // текст к скруглению углов 24 px.
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-11/12 w-full max-w-column flex-col rounded-t-sheet bg-raised px-5 pt-3 pb-sheet text-body text-ink shadow-sheet outline-none"
        >
          {/* Ручка — знак «можно смахнуть»; тянуть можно за любое место шторки. Размер 36 × 6 px (h-1.5 w-9) —
              размер знака по эталону mobile.html (36 × 5), а не отступ шкалы. */}
          <div aria-hidden className="mx-auto mb-4 h-1.5 w-9 shrink-0 rounded-full bg-muted/50" />
          <Drawer.Title className="text-title-2 text-ink">{title}</Drawer.Title>
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
