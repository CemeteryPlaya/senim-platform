"use client";

import { useState, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import type { Device } from "@/platform/device";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { Sheet } from "./Sheet";

export type ExplainProps = {
  /** Подпись ссылки, например «Что это?». */
  label: string;
  /** Заголовок пояснения. */
  title: string;
  device: Device;
  children: ReactNode;
};

/**
 * Ссылка-кнопка цвета `accent`: строчная (не ломает строку текста), а область нажатия расширена
 * псевдоэлементом до ~48 px по высоте. Отклик на нажатие — сразу, прозрачностью.
 */
const TRIGGER =
  "relative rounded-small font-medium text-accent underline-offset-4 transition-opacity duration-100 hover:underline active:opacity-60 before:absolute before:-inset-x-2 before:-inset-y-3";

/**
 * Пояснение по нажатию — только для сложных мест (защита сделки, гарантия оплаты, где деньги, спор…).
 * Телефон — шторка снизу с кнопкой «Понятно»; компьютер — поповер у ссылки.
 */
export function Explain({ label, title, device, children }: ExplainProps) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <button type="button" className={TRIGGER}>
      {label}
    </button>
  );

  if (device === "desktop") {
    return (
      <Popover trigger={trigger} title={title} open={open} onOpenChange={setOpen}>
        <div className="text-muted">{children}</div>
      </Popover>
    );
  }

  return (
    <Sheet trigger={trigger} title={title} open={open} onOpenChange={setOpen}>
      <div className="text-muted">{children}</div>
      <Button full className="mt-6" onClick={() => setOpen(false)}>
        {ru.app.kit.understood}
      </Button>
    </Sheet>
  );
}
