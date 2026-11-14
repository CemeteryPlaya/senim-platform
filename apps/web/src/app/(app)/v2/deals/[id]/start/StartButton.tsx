"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, ConfirmDialog, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../../_shell/form";
import { startWorkAction } from "./actions";

const t = ru.app.masterSteps.start;

type Props = { dealId: string; dealHref: string; /** Срок изготовления словами («30 дней»). */ days: string; device: Device };

/**
 * «Начать работу» с подтверждением: окно называет последствия точно (уведомление покупателю, срок с сегодняшнего дня,
 * отмена только через спор). Пока идёт вызов, окно не закрывается и второе нажатие не уходит; модуль делает один переход,
 * повтор отвечает тем же успехом. Успех — тост и карточка сделки; отказ — тост, окно остаётся; сделка уже на другом шаге —
 * карточка (её «Сейчас» покажет действующий шаг).
 */
export function StartButton({ dealId, dealHref, days, device }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  async function start(): Promise<boolean> {
    const result = await startWorkAction({ dealId });
    const outcome = outcomeOf(result, window.location);
    if (outcome.kind === "success") {
      setDone(true);
      toast(t.started);
      router.push(dealHref);
      return true;
    }
    if (outcome.kind === "leave") {
      // Сессия истекла — вход с возвратом сюда.
      window.location.assign(outcome.href);
      return true;
    }
    toast.error(outcome.error);
    if (!result.ok && result.code === "CONFLICT") {
      router.push(dealHref);
      return true;
    }
    return false;
  }

  return (
    <>
      <ActionDock>
        <Button onClick={() => setOpen(true)} pending={done}>
          {t.submit}
        </Button>
      </ActionDock>
      <ConfirmDialog
        device={device}
        open={open}
        onOpenChange={setOpen}
        title={t.confirm.title}
        description={t.confirm.body(days)}
        confirmLabel={t.confirm.confirm}
        cancelLabel={t.confirm.cancel}
        onConfirm={start}
      />
    </>
  );
}
