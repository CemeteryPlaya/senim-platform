"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { ConfirmDialog, Menu, StatusChip, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { useSettle } from "../../../../_shell/settle";
import { to } from "../../../../_shell/paths";
import { deleteWorkAction, setWorkPublishedAction } from "../actions";

const t = ru.app.masterPortfolio;

/**
 * Статус работы и «Действия с работой» за кнопкой «три точки»: опубликовать или скрыть из каталога (сразу) и удалить
 * (необратимо — подтверждение `danger`; пункт меню закрывает меню и открывает окно, фокус после него возвращается на
 * кнопку меню). Двойное нажатие гасит окно (кнопка в ожидании); повтор «опубликовать» с тем же значением ничего не меняет.
 */
export function WorkActions({ device, id, published }: { device: Device; id: string; published: boolean }) {
  const router = useRouter();
  const settle = useSettle({ keepOpenOnError: true });
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
