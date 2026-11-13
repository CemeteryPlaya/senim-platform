"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ru } from "@/i18n/ru";
import { ConfirmDialog, Menu, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../../_shell/form";
import { cancelRequestAction } from "../actions";

const t = ru.app.requestCard.actions;

/**
 * «Действия с заявкой» за кнопкой «три точки»: отмена с подтверждением, где названы последствия. Двойное нажатие даёт один
 * эффект: окно подтверждения не принимает второй клик, пока действие идёт, а модуль на повтор отвечает CONFLICT. После
 * отмены экран перерисовывается в состоянии «отменена» и показывает тост; сессия истекла — на вход с возвратом.
 */
export function RequestActions({ requestId, offersCount, device }: { requestId: string; offersCount: number; device: Device }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function cancel(): Promise<boolean> {
    const outcome = outcomeOf(await cancelRequestAction({ requestId }), window.location);
    if (outcome.kind === "leave") {
      window.location.assign(outcome.href);
      return false;
    }
    if (outcome.kind === "error") {
      toast.error(outcome.error);
      // Заявку уже изменили (вторая вкладка): покажем, как есть.
      router.refresh();
      return false;
    }
    toast(t.cancelled);
    router.refresh();
    return true;
  }

  return (
    <>
      <Menu label={t.menu} device={device} items={[{ label: t.cancel, tone: "danger", onSelect: () => setOpen(true) }]} />
      <ConfirmDialog
        device={device}
        tone="danger"
        open={open}
        onOpenChange={setOpen}
        title={t.cancelTitle}
        description={t.cancelBody(offersCount)}
        confirmLabel={t.cancel}
        cancelLabel={t.cancelKeep}
        onConfirm={cancel}
      />
    </>
  );
}
