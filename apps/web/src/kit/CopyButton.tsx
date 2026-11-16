"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";
import { copyText } from "./copy";
import { toast } from "./Toaster";

export type CopyButtonProps = {
  /** Что кладётся в буфер. */
  value: string;
  /** Имя кнопки для диктора: «Скопировать номер сделки». */
  label: string;
  className?: string;
};

/**
 * Копирование в одно касание: значок в круге 48 px, по нажатию — тост «Скопировано» (его слышит диктор: область тостов
 * `aria-live`) и на 1,5 с галочка вместо значка. Не вышло — тост «Не удалось скопировать». Clipboard API с запасным
 * путём (`copyText`). Клиентский компонент.
 */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const t = ru.app.kit.copy;
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    if (await copyText(value)) {
      toast(t.done);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1500);
    } else {
      toast.error(t.failed);
    }
  };

  const Icon = done ? Check : Copy;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => void onClick()}
      className={cn("inline-flex size-control min-h-control shrink-0 cursor-pointer items-center justify-center rounded-full text-muted pressable hover:bg-fill hover:text-ink", className)}
    >
      <Icon aria-hidden className="size-5" strokeWidth={1.75} />
    </button>
  );
}
