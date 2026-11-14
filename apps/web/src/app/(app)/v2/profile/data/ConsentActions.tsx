"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { ConfirmDialog, Menu, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../_shell/form";
import { revokeConsentAction } from "./actions";

const t = ru.app.profile.data;

/**
 * Тихое действие «Отозвать согласие на обработку данных» за кнопкой «три точки» и подтверждение с точным текстом
 * последствий (что произойдёт с доступом и данными; сделки с передачей данных банку названы по номерам). Двойное нажатие
 * даёт один эффект: окно не принимает второй клик, пока действие идёт, а при открытой заявке сервис возвращает ту же.
 * После заявки экран перерисовывается и показывает её статус и срок; в меню пункта больше нет.
 */
export function ConsentActions({ device, bankDeals }: { device: Device; bankDeals: string | null }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  async function revoke(): Promise<boolean> {
    const outcome = outcomeOf(await revokeConsentAction({}), window.location);
    if (outcome.kind === "leave") {
      window.location.assign(outcome.href);
      return false;
    }
    if (outcome.kind === "error") {
      toast.error(outcome.error);
      router.refresh();
      return false;
    }
    toast(t.revoke.requested);
    router.refresh();
    return true;
  }

  const description = bankDeals ? `${t.revoke.consequences} ${t.revoke.bankDeals(bankDeals)}` : t.revoke.consequences;
  return (
    <>
      <Menu label={t.menu} device={device} triggerRef={menuButton} items={[{ label: t.revoke.action, tone: "danger", onSelect: () => setOpen(true) }]} />
      <ConfirmDialog
        device={device}
        tone="danger"
        open={open}
        returnFocusTo={menuButton}
        onOpenChange={setOpen}
        title={t.revoke.title}
        description={description}
        confirmLabel={t.revoke.confirm}
        cancelLabel={t.revoke.cancel}
        onConfirm={revoke}
      />
    </>
  );
}
