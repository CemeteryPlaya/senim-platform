import { formatDate, formatDateTime, formatRelative, formatTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { ChatMessage } from "@/kit";
import type { ChatListItem, ChatView } from "@/modules/companies";
import { to } from "../../../_shell/paths";

// Чистая часть экранов переписки покупателя: данные модуля `companies` → строки для kit. Права, маску контактов и
// подписи собеседника даёт модуль; здесь только форма и время.

const t = ru.app.chat;

/** Модель ленты: всё, что нужно клиентской части, только простые значения (идёт и из серверных действий опроса). */
export type ChatRoomModel = {
  messages: ChatMessage[];
  canWrite: boolean;
  /** Почему писать нельзя; `null` — можно. */
  closedReason: string | null;
  /** Причина закрытия оператором; `null` — не закрыт им. */
  operatorReason: string | null;
  /** Оферта не заключена: контакты скрыты, телефоны и ссылки в сообщениях замаскированы модулем. */
  beforeOffer: boolean;
};

/** Время сообщения: сегодня — «14:30», раньше — «12 ноября 2026, 14:30». */
export function messageTime(sentAt: Date, now: Date): string {
  return formatDate(sentAt) === formatDate(now) ? formatTime(sentAt) : formatDateTime(sentAt);
}

/** Диалог → модель ленты. Системная строка про скрытые контакты стоит первой, пока оферта не заключена. */
export function chatRoomModel(view: ChatView, now: Date = new Date()): ChatRoomModel {
  // `contacts` отдаёт только состояние «оферта заключена» (у стороны сделки); до оферты — null.
  const beforeOffer = view.contacts === null;
  const messages: ChatMessage[] = view.messages.map((message) => ({
    id: message.id,
    text: message.text,
    time: messageTime(message.sentAt, now),
    mine: message.kind === "own",
    author: message.author,
  }));
  if (beforeOffer) messages.unshift({ id: "system:contacts-hidden", kind: "system", text: t.room.hiddenSystem, time: "" });
  return {
    messages,
    canWrite: view.canWrite,
    closedReason: view.closedReason,
    operatorReason: view.closedByOperator?.reason ?? null,
    beforeOffer,
  };
}

/** К чему относится диалог: сделка или предложение (по пути, который отдаёт модуль). */
export type ChatContext = { kind: "deal"; dealId: string } | { kind: "offer"; requestId: string; offerId: string };

const DEAL_PATH = /^\/deals\/([^/?#]+)/;
const OFFER_PATH = /^\/requests\/([^/?#]+)\/offers\/([^/?#]+)/;

/**
 * Путь v1 из `listChats().href` → к чему относится диалог. Сам путь адресом не служит: адрес диалога всегда
 * `/chats/<offerId>`, а ссылка на сделку или предложение собирается через `to()`. Неизвестный путь — `null`.
 */
export function contextOfHref(href: string, offerId: string): ChatContext | null {
  const deal = DEAL_PATH.exec(href);
  if (deal) return { kind: "deal", dealId: deal[1] };
  const offer = OFFER_PATH.exec(href);
  if (offer) return { kind: "offer", requestId: offer[1], offerId: offer[2] ?? offerId };
  return null;
}

/** Адрес и подпись ссылки «к чему относится». */
export function contextLink(context: ChatContext | null, title: string | null): { href: string; label: string } | null {
  if (!context) return null;
  if (context.kind === "deal") {
    return { href: to(`/deals/${encodeURIComponent(context.dealId)}`), label: title ? t.room.aboutDeal(title) : t.room.aboutDealShort };
  }
  const href = to(`/requests/${encodeURIComponent(context.requestId)}/offers/${encodeURIComponent(context.offerId)}`);
  return { href, label: title ? t.room.aboutOffer(title) : t.room.aboutOfferShort };
}

export type ChatRowView = {
  offerId: string;
  href: string;
  counterpart: string;
  title: string;
  last: string;
  time: string | null;
  closed: boolean;
};

/** Адрес диалога покупателя. */
export const chatHref = (offerId: string): string => to(`/chats/${encodeURIComponent(offerId)}`);

/** Строки списка диалогов: адрес — всегда экран диалога v2. Модуль не отдаёт «непрочитанное» — признака нет. */
export function chatRows(items: readonly ChatListItem[], now: Date = new Date()): ChatRowView[] {
  return items.map((item) => ({
    offerId: item.offerId,
    href: chatHref(item.offerId),
    counterpart: item.counterpart,
    title: item.title,
    last: item.lastMessage ?? t.list.noMessages,
    time: item.lastAt ? formatRelative(item.lastAt, now) : null,
    closed: item.closed,
  }));
}
