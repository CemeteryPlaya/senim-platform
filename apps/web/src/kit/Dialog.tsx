"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import type { Device } from "@/platform/device";
import { Button } from "./Button";
import { FADE, presence } from "./motion";
import { useOpenState, useReturnFocus, withoutDescription } from "./overlay-state";
import { Sheet } from "./Sheet";

export type DialogProps = {
  /** Открыт ли диалог. Без `open` диалог управляется сам и открывается триггером. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  /** Кнопка, открывающая диалог (один элемент); получает `aria-haspopup="dialog"`. */
  trigger?: ReactElement;
  /** `false` — диалог нельзя закрыть Esc, затемнением и крестиком (например, пока идёт действие). */
  dismissible?: boolean;
  children?: ReactNode;
};

/**
 * Диалог по центру (компьютер). Окно — Radix Dialog: фокус заперт внутри и возвращается на триггер, Esc и нажатие
 * на затемнение закрывают, прокрутка страницы заблокирована. Движение — motion: вход и выход по одному пути
 * (масштаб 0,96 → 1 и проявление, пружина без отскока); при `prefers-reduced-motion` — только проявление.
 * Затемнение — утилита `scrim`: при `prefers-reduced-transparency` оно сплошное.
 */
export function Dialog({ open, onOpenChange, title, description, trigger, dismissible = true, children }: DialogProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const returnFocus = useReturnFocus(isOpen, trigger === undefined);
  const reduced = useReducedMotion() ?? false;
  const change = (next: boolean) => {
    if (next || dismissible) setOpen(next);
  };

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={change}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <AnimatePresence>
        {isOpen && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay forceMount asChild>
              <motion.div
                className="scrim fixed inset-0 z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FADE}
              />
            </DialogPrimitive.Overlay>
            {/* Обёртка только центрирует; нажатия проходят сквозь неё на затемнение. */}
            <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
              <DialogPrimitive.Content
                forceMount
                asChild
                {...withoutDescription(description)}
                onCloseAutoFocus={returnFocus}
              >
                <motion.div
                  className="pointer-events-auto relative flex max-h-full w-full max-w-md flex-col overflow-y-auto rounded-card bg-raised p-6 text-body text-ink shadow-float outline-none"
                  {...presence(reduced, { scale: 0.96 })}
                >
                  <DialogPrimitive.Title className="pr-12 text-section text-ink">{title}</DialogPrimitive.Title>
                  {description && (
                    <DialogPrimitive.Description className="mt-2 text-body text-muted">
                      {description}
                    </DialogPrimitive.Description>
                  )}
                  {children && <div className="mt-5">{children}</div>}
                  <DialogPrimitive.Close
                    aria-label={ru.app.kit.close}
                    disabled={!dismissible}
                    className="absolute top-3 right-3 inline-flex size-control items-center justify-center rounded-control text-muted transition-transform duration-100 hover:bg-line active:scale-press disabled:opacity-50"
                  >
                    <X aria-hidden className="size-5" />
                  </DialogPrimitive.Close>
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export type ConfirmDialogProps = {
  /** Телефон — шторка снизу, компьютер — диалог по центру. */
  device: Device;
  title: string;
  description: string;
  /** Глагол, называющий результат: «Отменить сделку», а не «Ок». */
  confirmLabel: string;
  /** Подпись отказа; по умолчанию «Отмена». */
  cancelLabel?: string;
  /** `danger` — необратимое действие: кнопка подтверждения в цвете ошибки. */
  tone?: "primary" | "danger";
  /**
   * Действие. Пока промис не завершён, кнопка показывает ожидание, повторное нажатие и закрытие окна
   * (Esc, затемнение, жест, «Отмена») не срабатывают. Успех закрывает окно; ошибка оставляет его открытым
   * и уходит дальше — показать её (тостом) должен вызывающий.
   */
  onConfirm: () => void | Promise<void>;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Подтверждение действия: одна главная кнопка (подтвердить) и отказ. */
export function ConfirmDialog({
  device,
  title,
  description,
  confirmLabel,
  cancelLabel = ru.app.kit.cancel,
  tone = "primary",
  onConfirm,
  trigger,
  open,
  onOpenChange,
}: ConfirmDialogProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const [pending, setPending] = useState(false);
  // Ref, а не только состояние: второй клик может прийти раньше, чем React применит setPending.
  const running = useRef(false);

  const change = (next: boolean) => {
    if (next || !running.current) setOpen(next);
  };

  async function confirm() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  const mobile = device === "mobile";
  const confirmButton = (
    <Button variant={tone === "danger" ? "danger" : "primary"} full={mobile} pending={pending} onClick={confirm}>
      {confirmLabel}
    </Button>
  );
  const cancelButton = (
    <Button variant={mobile ? "quiet" : "secondary"} full={mobile} disabled={pending} onClick={() => change(false)}>
      {cancelLabel}
    </Button>
  );
  const common = { title, description, trigger, open: isOpen, onOpenChange: change, dismissible: !pending };

  if (mobile) {
    // Телефон: главное действие внизу, в зоне большого пальца; отказ — под ним.
    return (
      <Sheet {...common}>
        <div className="mt-2 flex flex-col gap-2">
          {confirmButton}
          {cancelButton}
        </div>
      </Sheet>
    );
  }
  return (
    <Dialog {...common}>
      <div className="flex justify-end gap-3">
        {cancelButton}
        {confirmButton}
      </div>
    </Dialog>
  );
}
