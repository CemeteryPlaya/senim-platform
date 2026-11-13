"use client";

import { Paperclip, SendHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { ru } from "@/i18n/ru";
import type { Device } from "@/platform/device";
import { Button } from "./Button";
import { canSend, composerKeyAction, counterVisible } from "./chat-logic";
import { cn } from "./cn";

export type ChatComposerProps = {
  /** Отправка текста. `false` (или промис с `false`) — отправка не удалась, текст остаётся в поле. */
  onSend: (text: string) => void | boolean | Promise<void | boolean>;
  /** Идёт отправка: кнопка в ожидании, повторная отправка гасится. */
  pending?: boolean;
  /** Предел длины; приближаясь к нему, поле показывает счётчик, сверх предела отправка недоступна. */
  maxLength?: number;
  /** От устройства зависит Enter: на компьютере отправляет, на телефоне — перенос строки. */
  device: Device;
  /** Имя поля для диктора; по умолчанию «Сообщение». */
  label?: string;
  placeholder?: string;
  /** Кнопка вложения; без обработчика её нет. Сам выбор файла — у вызывающего (`Uploader` или его замена). */
  onAttach?: () => void;
};

/**
 * Поле сообщения: многострочное, растёт до пяти строк, счётчик у предела, кнопка отправки (значок, имя из `ru`).
 * Это не главная кнопка экрана (`data-primary-action` нет). На телефоне панель прилипает к низу области над панелью
 * вкладок (как `ActionDock`, с безопасной зоной); на компьютере стоит в потоке под лентой. Клиентский компонент.
 */
export function ChatComposer({ onSend, pending = false, maxLength, device, label, placeholder, onAttach }: ChatComposerProps) {
  const t = ru.app.kit.chat;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const counterId = useId();
  const ready = canSend(text, maxLength, pending || busy);

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const result = await onSend(text);
      if (result !== false) setText("");
    } finally {
      setBusy(false);
    }
  };

  const showCounter = counterVisible(text.length, maxLength);
  const over = maxLength !== undefined && text.length > maxLength;

  return (
    <form
      data-action-dock
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="flex flex-col gap-2 mobile:sticky mobile:z-10 mobile:mt-auto mobile:glass mobile:dock-above-bar mobile:dock-bleed mobile:rounded-bar mobile:border mobile:border-line mobile:p-2 mobile:shadow-float"
    >
      <div className="flex items-end gap-2">
        {onAttach && (
          <Button variant="quiet" flush aria-label={t.attach} className="min-w-control" onClick={onAttach}>
            <Paperclip aria-hidden className="size-6" />
          </Button>
        )}
        <textarea
          aria-label={label ?? t.message}
          aria-describedby={showCounter ? counterId : undefined}
          aria-invalid={over ? true : undefined}
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (composerKeyAction({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing }, device) === "send") {
              event.preventDefault();
              void send();
            }
          }}
          className={cn(
            "max-h-composer min-h-control min-w-0 flex-1 resize-none field-sizing-content rounded-field border bg-surface px-4 py-3 text-body text-ink placeholder:text-muted",
            over ? "border-danger" : "border-line-strong",
          )}
        />
        <Button variant="secondary" type="submit" aria-label={t.send} pending={pending || busy} disabled={!ready && !(pending || busy)} className="min-w-control">
          <SendHorizontal aria-hidden className="size-6" />
        </Button>
      </div>
      {showCounter && maxLength !== undefined && (
        <p id={counterId} className={cn("px-2 text-small tabular-nums", over ? "text-danger" : "text-muted")}>
          {t.counter(text.length, maxLength)}
        </p>
      )}
    </form>
  );
}
