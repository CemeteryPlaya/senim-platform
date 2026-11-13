"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { ConfirmDialog, Menu, toast, type MenuItem } from "@/kit";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../../_shell/form";
import { cancelDealAction } from "../actions";

const t = ru.app.deal.card.actions;

export type DealActionsProps = {
  dealId: string;
  /** Текст последствий отмены; `null` — отменить нельзя (пункта нет). */
  cancelText: string | null;
  /** Адрес экрана «Открыть спор»; `null` — спор открыть нельзя. */
  disputeHref: string | null;
  device: Device;
};

/**
 * «Действия со сделкой» за кнопкой «три точки»: «Отменить сделку» (подтверждение с точным текстом последствий) и «Открыть
 * спор» (переход на экран спора). Двойное нажатие даёт один эффект: окно не принимает второй клик, пока действие идёт, а
 * модуль на повтор отвечает CONFLICT. После отмены экран перерисовывается в новом состоянии и показывает тост; после
 * «Не отменять» и Esc фокус возвращается на кнопку «Действия» (меню к этому времени закрыто).
 */
export function DealActions({ dealId, cancelText, disputeHref, device }: DealActionsProps) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  async function cancel(): Promise<boolean> {
    const result = await cancelDealAction({ dealId });
    const outcome = outcomeOf(result, window.location);
    if (outcome.kind === "leave") {
      window.location.assign(outcome.href);
      return false;
    }
    if (outcome.kind === "error") {
      toast.error(outcome.error);
      // Сделку уже изменили (вторая вкладка, другая сторона): покажем, как есть.
      router.refresh();
      return false;
    }
    toast(result.ok && result.data.status === "REFUND_REQUESTED" ? t.refundRequested : t.cancelled);
    router.refresh();
    return true;
  }

  const items: MenuItem[] = [
    ...(cancelText !== null ? [{ label: t.cancel, tone: "danger" as const, onSelect: () => setOpen(true) }] : []),
    ...(disputeHref !== null ? [{ label: t.dispute, href: disputeHref }] : []),
  ];
  if (items.length === 0) return null;

  return (
    <>
      <Menu label={t.menu} device={device} triggerRef={menuButton} items={items} />
      {cancelText !== null && (
        <ConfirmDialog
          device={device}
          tone="danger"
          open={open}
          returnFocusTo={menuButton}
          onOpenChange={setOpen}
          title={t.cancelTitle}
          description={cancelText}
          confirmLabel={t.cancel}
          cancelLabel={t.keep}
          onConfirm={cancel}
        />
      )}
    </>
  );
}
