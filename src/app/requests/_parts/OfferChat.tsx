"use client";

import { ru } from "@/i18n/ru";
import { Chat, type ChatMessage } from "@/ui";

export type OfferChatLine = { id: string; mine: boolean; text: string; sentAt: Date; masked: boolean };

/**
 * Переписка по отклику (только чтение).
 * INTEGRATOR: заменить на чат companies из `_components/chat` (отправка с маскировкой контактов):
 * <OfferChat offerId={offerId} /> — пропсы уточнит companies-engineer.
 */
export function OfferChat({ lines, otherLabel, title }: { lines: readonly OfferChatLine[]; otherLabel: string; title: string }) {
  const messages: ChatMessage[] = lines.map((l) => ({
    id: l.id,
    kind: l.mine ? "own" : "other",
    author: l.mine ? undefined : otherLabel,
    text: l.text,
    sentAt: l.sentAt,
    masked: l.masked,
  }));
  return <Chat title={title} messages={messages} onSend={() => undefined} disabledReason={ru.requests.offer.chatSoon} />;
}
