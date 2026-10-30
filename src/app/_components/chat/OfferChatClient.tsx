"use client";

import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ru } from "@/i18n/ru";
import type { ChatView } from "@/modules/companies";
import { Alert, Chat, cn } from "@/ui";
import { loadChat, sendChatMessage } from "./actions";

/** Как часто обновлять ленту, пока вкладка видна. */
const POLL_MS = 5_000;

type Props = { id: string; offerId: string; initial: ChatView; title: string; className?: string };

export function OfferChatClient({ id, offerId, initial, title, className }: Props) {
  const [chat, setChat] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadChat({ offerId });
    if (result.ok) setChat(result.data);
  }, [offerId]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const send = async (text: string) => {
    setError(null);
    const result = await sendChatMessage({ offerId, text });
    if (!result.ok) {
      setError(result.error);
      // Chat оставит текст в поле и покажет, что сообщение не ушло.
      throw new Error(result.error);
    }
    setChat((prev) => ({ ...prev, messages: [...prev.messages.filter((m) => m.id !== result.data.id), result.data] }));
  };

  return (
    <div id={id} className={cn("flex scroll-mt-24 flex-col gap-3", className)}>
      <Chat
        title={title}
        messages={chat.messages}
        onSend={send}
        disabledReason={chat.canWrite ? undefined : chat.closedReason}
      />
      {chat.canWrite && (
        <p className="flex items-start gap-2 text-sm text-muted">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          {ru.companies.chat.note}
        </p>
      )}
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}
