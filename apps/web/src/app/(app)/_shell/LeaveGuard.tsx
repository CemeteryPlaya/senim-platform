"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ru } from "@/i18n/ru";
import { ConfirmDialog } from "@/kit";
import type { Device } from "@/platform/device";
import { leavingPath } from "./leave-guard";

/**
 * Предупреждение об уходе с заполненной формы, у которой нет черновика (спор, отзыв, отчёт, предложение, компания,
 * портфолио): пока `dirty`, переход по ссылке сайта спрашивает «Выйти без сохранения?», закрытие вкладки и перезагрузка —
 * системное предупреждение браузера. Пустая форма уходит без вопросов. «Назад» браузера (жест) не перехватывается.
 * Ставится рядом с формой; ничего не рисует, пока вопрос не задан.
 */
export function LeaveGuard({ dirty, device }: { dirty: boolean; device: Device }) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      const path = leavingPath({
        button: event.button,
        modifiers: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        defaultPrevented: event.defaultPrevented,
        link: anchor ? { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") } : null,
        here: { origin: window.location.origin, pathname: window.location.pathname, search: window.location.search },
      });
      if (path === null) return;
      // Ссылка Next перехватывается раньше её собственного обработчика (capture): переход откроется после ответа.
      event.preventDefault();
      event.stopPropagation();
      setTarget(path);
    };
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);

  const t = ru.app.kit.leaveGuard;
  return (
    <ConfirmDialog
      device={device}
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
      title={t.title}
      description={t.description}
      confirmLabel={t.confirm}
      cancelLabel={t.stay}
      onConfirm={() => {
        if (target !== null) router.push(target);
      }}
    />
  );
}
