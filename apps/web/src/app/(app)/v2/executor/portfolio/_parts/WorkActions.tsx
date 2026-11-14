"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { ConfirmDialog, Menu, StatusChip, toast } from "@/kit";
import type { ActionResult } from "@/platform/action";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../../_shell/form";
import { to } from "../../../../_shell/paths";
import { deleteWorkAction, setWorkPublishedAction } from "../actions";

const t = ru.app.masterPortfolio;

/**
 * Ответ действия, вызванного не формой: успех — `onSuccess`; «сессия истекла» / «нужно согласие» — уход на экран v2 с
 * возвратом (outcomeOf); отказ — тост с текстом сервера. Возвращает `false` при отказе: окно подтверждения остаётся
 * открытым (тост уже показан), при успехе и уходе — закрывается.
 */
function useSettle() {
  const router = useRouter();
  return <T,>(result: ActionResult<T>, onSuccess: (data: T) => void): boolean => {
    const outcome = outcomeOf(result, window.location);
    if (outcome.kind === "success") {
      onSuccess(outcome.data);
      return true;
    }
    if (outcome.kind === "leave") {
      window.location.assign(outcome.href);
      return true;
    }
    toast.error(outcome.error);
    router.refresh();
    return false;
  };
}

/**
 * Статус работы и «Действия с работой» за кнопкой «три точки»: опубликовать или скрыть из каталога (сразу) и удалить
 * (необратимо — подтверждение `danger`; пункт меню закрывает меню и открывает окно, фокус после него возвращается на
 * кнопку меню). Двойное нажатие гасит окно (кнопка в ожидании); повтор «опубликовать» с тем же значением ничего не меняет.
 */
export function WorkActions({ device, id, published }: { device: Device; id: string; published: boolean }) {
  const router = useRouter();
  const settle = useSettle();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const togglePublished = async () => {
    const next = !published;
    settle(await setWorkPublishedAction({ id, published: next }), () => {
      toast(next ? t.actions.published : t.actions.unpublished);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <StatusChip tone={published ? "accent" : "neutral"}>{published ? t.list.published : t.list.hidden}</StatusChip>
      <Menu
        label={t.actions.menu}
        device={device}
        triggerRef={menuButton}
        items={[
          { label: published ? t.actions.unpublish : t.actions.publish, onSelect: () => void togglePublished() },
          { label: t.actions.delete, tone: "danger", onSelect: () => setOpen(true) },
        ]}
      />
      <ConfirmDialog
        device={device}
        tone="danger"
        open={open}
        returnFocusTo={menuButton}
        onOpenChange={setOpen}
        title={t.actions.deleteConfirm.title}
        description={t.actions.deleteConfirm.description}
        confirmLabel={t.actions.deleteConfirm.confirm}
        cancelLabel={t.actions.deleteConfirm.keep}
        onConfirm={async () =>
          settle(await deleteWorkAction({ id }), () => {
            toast(t.actions.deleted);
            router.replace(to("/executor/portfolio"));
          })
        }
      />
    </div>
  );
}
