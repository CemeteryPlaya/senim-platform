"use client";

import { Info, Send, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Button, type ButtonVariant } from "./Button";
import { cn } from "./cn";
import { DateText } from "./display";
import type { DateInput } from "./format";

export type ChatMessage = {
  id: string;
  /** own — моё (справа), other — собеседник (слева), system — событие сделки (по центру). */
  kind: "own" | "other" | "system";
  /** Подпись автора у чужих сообщений, например «Исполнитель №17». */
  author?: string;
  text: string;
  sentAt: DateInput;
  /** В тексте были скрыты контакты — показать пояснение. */
  masked?: boolean;
};

export type ChatProps = {
  messages: readonly ChatMessage[];
  /** Отправка. Пока промис не завершён — поле заблокировано; при ошибке текст остаётся в поле. */
  onSend: (text: string) => void | Promise<void>;
  /** Чат только для чтения (сделка закрыта и т. п.) — вместо поля показывается причина. */
  disabledReason?: ReactNode;
  /** Заголовок над лентой (для диктора — подпись области сообщений). */
  title?: string;
  emptyText?: ReactNode;
  maxLength?: number;
  /** Вид кнопки «Отправить»: на экране, где главное действие другое (сделка), — secondary. */
  sendVariant?: ButtonVariant;
  className?: string;
};

/** Презентационный чат: лента, своё/чужое/системное, поле ввода. Данные и отправка — через пропсы. */
export function Chat({
  messages,
  onSend,
  disabledReason,
  title = ru.common.ui.chat.label,
  emptyText = ru.common.ui.chat.empty,
  maxLength = 2000,
  sendVariant = "primary",
  className,
}: ChatProps) {
  const t = ru.common.ui.chat;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const inputId = useId();
  const titleId = useId();

  // Новое сообщение — прокручиваем ленту вниз.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setFailed(false);
    try {
      await onSend(value);
      setText("");
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <section aria-labelledby={titleId} className={cn("flex flex-col rounded-card border border-line bg-surface", className)}>
      <h2 id={titleId} className="border-b border-line px-4 py-3 text-lg font-semibold text-ink">
        {title}
      </h2>

      {messages.length === 0 ? (
        <p className="px-4 py-8 text-base text-muted">{emptyText}</p>
      ) : (
        <ol ref={listRef} role="log" aria-live="polite" aria-labelledby={titleId} tabIndex={0} className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-4 py-4">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} />
          ))}
        </ol>
      )}

      <div className="border-t border-line p-4">
        {disabledReason ? (
          <p className="text-base text-muted">{disabledReason}</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-base font-semibold text-ink">
              {t.input}
            </label>
            <textarea
              id={inputId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={maxLength}
              rows={2}
              // Во время отправки поле только для чтения, а не disabled: фокус остаётся в поле.
              readOnly={sending}
              aria-busy={sending || undefined}
              aria-describedby={`${inputId}-hint`}
              className="block min-h-control w-full resize-y rounded-control border border-line-strong bg-surface px-4 py-2 text-base text-ink placeholder:text-muted read-only:bg-sunken hover:border-ink focus-visible:border-primary"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p id={`${inputId}-hint`} className="hidden text-sm text-muted sm:block">
                {t.hint}
              </p>
              <Button type="submit" variant={sendVariant} loading={sending} disabled={!text.trim()} icon={<Send className="size-5" />}>
                {sending ? t.sending : ru.common.actions.send}
              </Button>
            </div>
            {failed && (
              <p role="alert" className="text-sm font-semibold text-danger">
                {t.failed}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}

function MessageItem({ message: m }: { message: ChatMessage }) {
  if (m.kind === "system") {
    return (
      <li className="flex items-start justify-center gap-2 py-1 text-center text-sm text-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {m.text} <DateText value={m.sentAt} format="time" />
        </span>
      </li>
    );
  }

  const own = m.kind === "own";
  return (
    <li className={cn("flex max-w-[85%] flex-col gap-1", own ? "items-end self-end" : "items-start self-start")}>
      <p className="text-sm text-muted">
        <span className="font-semibold text-ink-soft">{own ? ru.common.ui.chat.you : m.author}</span>{" "}
        <DateText value={m.sentAt} format="time" />
      </p>
      <p className={cn("max-w-full rounded-card px-4 py-2.5 text-base whitespace-pre-wrap break-words text-ink", own ? "rounded-br-badge bg-accent-soft" : "rounded-bl-badge bg-sunken")}>{m.text}</p>
      {m.masked && (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <ShieldCheck aria-hidden className="size-4 shrink-0" />
          {ru.common.ui.chat.masked}
        </p>
      )}
    </li>
  );
}
