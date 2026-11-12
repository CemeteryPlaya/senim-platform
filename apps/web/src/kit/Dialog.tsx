"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import type { Device } from "@/platform/device";
import { logger } from "@/platform/logger";
import { Button } from "./Button";
import { FADE, presence } from "./motion";
import { createConfirmRunner, useOpenState, useReturnFocus, type ConfirmAction } from "./overlay-state";
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
  /** Первый фокус при открытии; по умолчанию — первый элемент управления (так делает Radix). */
  onOpenAutoFocus?: (event: Event) => void;
  children?: ReactNode;
};

/**
 * Диалог по центру (компьютер). Окно — Radix Dialog: Tab ходит по кругу внутри, фокус возвращается на триггер,
 * Esc и нажатие на затемнение закрывают, прокрутка страницы заблокирована. Движение — motion: вход и выход по
 * одному пути (масштаб 0,96 → 1 и проявление, пружина без отскока); при `prefers-reduced-motion` — только
 * проявление. Затемнение — утилита `scrim`: при `prefers-reduced-transparency` оно плотнее.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  dismissible = true,
  onOpenAutoFocus,
  children,
}: DialogProps) {
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
                onOpenAutoFocus={onOpenAutoFocus}
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
   * Действие. Пока оно идёт, кнопка показывает ожидание, повторное нажатие и закрытие окна (Esc, затемнение,
   * жест, «Отмена») не срабатывают. Итог:
   * - вернуло ничего или `true` — окно закрывается;
   * - вернуло `false` — окно остаётся открытым (например, сервер отказал, и действие уже показало тост);
   * - бросило исключение или промис отклонён — окно остаётся открытым, ошибка пишется в лог и дальше не идёт.
   *
   * Показать ошибку пользователю (тостом `toast.error(...)`) — обязанность самого `onConfirm`: окно её не видит
   * и текста для неё не знает.
   */
  onConfirm: ConfirmAction;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Подтверждение действия: одна главная кнопка (подтвердить) и отказ. Первый фокус — на «Отмене»: Enter сразу
 * после открытия не должен подтвердить необратимое действие.
 */
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
  const actions = useRef<HTMLDivElement>(null);
  const [runner] = useState(() =>
    createConfirmRunner({
      setPending,
      onError: (error) => logger.warn("kit.confirm-dialog: onConfirm failed", { error }),
    }),
  );

  const change = (next: boolean) => {
    if (next || !runner.running) setOpen(next);
  };
  const focusCancel = (event: Event) => {
    const cancel = actions.current?.querySelector<HTMLElement>("[data-confirm-cancel]");
    if (!cancel) return;
    event.preventDefault();
    cancel.focus({ preventScroll: true });
  };

  const mobile = device === "mobile";
  const confirmButton = (
    <Button
      variant={tone === "danger" ? "danger" : "primary"}
      full={mobile}
      pending={pending}
      onClick={() => void runner.run(onConfirm, () => setOpen(false))}
    >
      {confirmLabel}
    </Button>
  );
  const cancelButton = (
    <Button
      data-confirm-cancel
      variant={mobile ? "quiet" : "secondary"}
      full={mobile}
      // Не native disabled: фокус стоит на «Отмене» с открытия, и выключенная кнопка в Safari сбросила бы его
      // на <body>. Нажатие во время действия ничего не делает — закрытие гасит и change (раннер занят).
      aria-disabled={pending || undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (!pending) change(false);
      }}
    >
      {cancelLabel}
    </Button>
  );
  const common = {
    title,
    description,
    trigger,
    open: isOpen,
    onOpenChange: change,
    dismissible: !pending,
    onOpenAutoFocus: focusCancel,
  };

  if (mobile) {
    // Телефон: главное действие внизу, в зоне большого пальца; отказ — под ним.
    return (
      <Sheet {...common}>
        <div ref={actions} className="mt-2 flex flex-col gap-2">
          {confirmButton}
          {cancelButton}
        </div>
      </Sheet>
    );
  }
  return (
    <Dialog {...common}>
      <div ref={actions} className="flex justify-end gap-3">
        {cancelButton}
        {confirmButton}
      </div>
    </Dialog>
  );
}
