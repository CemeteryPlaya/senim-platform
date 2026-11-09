"use client";

import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ru } from "@/i18n/ru";
import type { ChatView } from "@/modules/companies";
import { Alert, Chat, cn } from "@/ui";
import { loadChat, sendChatMessage } from "./actions";
import { ChatModeration } from "./ChatModeration";
import { ClientPhone } from "./ClientPhone";
import { PartyContacts } from "./PartyContacts";

/** Как часто обновлять ленту, пока вкладка видна. */
const POLL_MS = 5_000;

type Props = {
  id: string;
  offerId: string;
  initial: ChatView;
  title: string;
  reasonMax: number;
  /** Строка контактов под лентой (после оферты). В сделке — false: там контакты уже в карточке DealContacts. */
  showContacts?: boolean;
  className?: string;
};

const m = ru.companies.chat.moderation;

export function OfferChatClient({ id, offerId, initial, title, reasonMax, showContacts = true, className }: Props) {
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
      {chat.closedByOperator && (
        <Alert tone="warning" title={m.closedTitle}>
          <p>{m.closedReason(chat.closedByOperator.reason)}</p>
          <p>{m.closedHint}</p>
        </Alert>
      )}
      <Chat
        title={title}
        messages={chat.messages}
        onSend={send}
        // «Отправить» — обводкой: на каждом экране с чатом отклика своё главное действие (торг, отклик, шаг
        // сделки), а заливная кнопка на экране одна.
        sendVariant="secondary"
        disabledReason={chat.canWrite ? undefined : chat.closedReason}
      />
      {chat.clientPhone && <ClientPhone offerId={offerId} view={chat.clientPhone} onChanged={refresh} />}
      {showContacts && chat.contacts && <PartyContacts contacts={chat.contacts} compact />}
      {/* Подсказка про маску — только до оферты: после неё контакты не скрываются (contacts-policy.ts). */}
      {chat.canWrite && !chat.contacts && (
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
      {chat.canModerate && <ChatModeration offerId={offerId} closed={chat.closedByOperator !== null} reasonMax={reasonMax} onChanged={refresh} />}
    </div>
  );
}
