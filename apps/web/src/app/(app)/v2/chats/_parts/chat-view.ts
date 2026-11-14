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
  /** Почему писать нельзя (свой текст по коду причины); `null` — можно. */
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

/** Текст причины закрытия по коду модуля; неизвестный код — общий «Чат закрыт» (текст модуля покупателю не показываем). */
export function closedText(view: Pick<ChatView, "canWrite" | "closedCode">): string | null {
  if (view.canWrite) return null;
  return view.closedCode ? t.room.closed[view.closedCode] : t.room.closedGeneric;
}

/**
 * Диалог → модель ленты. Системная строка про скрытые контакты стоит первой, пока оферта не заключена. Вложения —
 * адреса из `view.attachments` (запрошены у модуля; подпись «Фото N» по порядку в сообщении).
 */
export function chatRoomModel(view: ChatView, now: Date = new Date()): ChatRoomModel {
  const attachments = view.attachments;
  // `contacts` отдаёт только состояние «оферта заключена» (у стороны сделки); до оферты — null.
  const beforeOffer = view.contacts === null;
  const messages: ChatMessage[] = view.messages.map((message) => ({
    id: message.id,
    text: message.text,
    time: messageTime(message.sentAt, now),
    mine: message.kind === "own",
    author: message.author,
    attachments: attachments
      .filter((file) => file.messageId === message.id)
      .map((file, index) => ({ id: file.id, url: file.url, previewUrl: file.url, name: t.room.photo(index + 1) })),
  }));
  if (beforeOffer) messages.unshift({ id: "system:contacts-hidden", kind: "system", text: t.room.hiddenSystem, time: "" });
  return {
    messages,
    canWrite: view.canWrite,
    closedReason: closedText(view),
    operatorReason: view.closedByOperator?.reason ?? null,
    beforeOffer,
  };
}

/** К чему относится диалог: сделка, если она есть, иначе предложение (данные диалога от модуля). */
export type ChatContext = { kind: "deal"; dealId: string } | { kind: "offer"; requestId: string; offerId: string };

export function contextOf(view: Pick<ChatView, "dealId" | "requestId" | "offerId">): ChatContext {
  return view.dealId ? { kind: "deal", dealId: view.dealId } : { kind: "offer", requestId: view.requestId, offerId: view.offerId };
}

/** Адрес и подпись ссылки «к чему относится». */
export function contextLink(context: ChatContext, title: string | null): { href: string; label: string } {
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

/**
 * Строки списка диалогов: адрес — всегда экран диалога v2. Только диалоги с сообщениями: пустой диалог по предложению
 * открывается с экрана предложения. Модуль не отдаёт «непрочитанное» — признака нет.
 */
export function chatRows(items: readonly ChatListItem[], now: Date = new Date()): ChatRowView[] {
  return items.filter((item) => item.lastMessage !== null).map((item) => ({
    offerId: item.offerId,
    href: chatHref(item.offerId),
    counterpart: item.counterpart,
    title: item.title,
    last: item.lastMessage ?? "",
    time: item.lastAt ? formatRelative(item.lastAt, now) : null,
    closed: item.closed,
  }));
}
