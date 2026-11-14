import { formatDate, formatDateTime, formatRelative, formatTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { ChatMessage } from "@/kit";
import type { ChatListItem, ChatView } from "@/modules/companies";
import { to } from "../../../_shell/paths";
import type { DealSide } from "../../../_shell/side";

// Чистая часть экранов переписки обеих сторон: данные модуля `companies` → строки для kit. Права, маску контактов и
// подписи собеседника даёт модуль; здесь только форма, время и слова стороны: мастеру собеседник — «Покупатель» (модуль
// называет его по-старому), причины закрытия и «к чему относится» — его словами.

const t = ru.app.chat;
const tm = ru.app.masterDeal.chat;

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

/** Текст причины закрытия по коду модуля словами стороны; неизвестный код — общий «Чат закрыт» (текст модуля не показываем). */
export function closedText(view: Pick<ChatView, "canWrite" | "closedCode">, side: DealSide = "CLIENT"): string | null {
  if (view.canWrite) return null;
  if (!view.closedCode) return t.room.closedGeneric;
  return side === "EXECUTOR" ? tm.room.closed[view.closedCode] : t.room.closed[view.closedCode];
}

/** Подпись собеседника: мастеру — «Покупатель» (модуль называет его иначе), покупателю — как отдаёт модуль («Исполнитель №N» до оферты). */
export const counterpartOf = (moduleLabel: string, side: DealSide): string => (side === "EXECUTOR" ? tm.counterpart : moduleLabel);

/**
 * Диалог → модель ленты глазами стороны. Системная строка про скрытые контакты стоит первой, пока оферта не заключена.
 * Вложения — адреса из `view.attachments` (запрошены у модуля; подпись «Фото N» по порядку в сообщении). Автор чужих
 * сообщений — собеседник (`counterpartOf`).
 */
export function chatRoomModel(view: ChatView, now: Date = new Date(), side: DealSide = "CLIENT"): ChatRoomModel {
  const attachments = view.attachments;
  // `contacts` отдаёт только состояние «оферта заключена» (у стороны сделки); до оферты — null.
  const beforeOffer = view.contacts === null;
  const messages: ChatMessage[] = view.messages.map((message) => ({
    id: message.id,
    text: message.text,
    time: messageTime(message.sentAt, now),
    mine: message.kind === "own",
    author: message.kind === "own" ? message.author : counterpartOf(message.author, side),
    attachments: attachments
      .filter((file) => file.messageId === message.id)
      .map((file, index) => ({ id: file.id, url: file.url, previewUrl: file.url, name: t.room.photo(index + 1) })),
  }));
  if (beforeOffer) messages.unshift({ id: "system:contacts-hidden", kind: "system", text: t.room.hiddenSystem, time: "" });
  return {
    messages,
    canWrite: view.canWrite,
    closedReason: closedText(view, side),
    operatorReason: view.closedByOperator?.reason ?? null,
    beforeOffer,
  };
}

/** К чему относится диалог: сделка, если она есть, иначе предложение (данные диалога от модуля). */
export type ChatContext = { kind: "deal"; dealId: string } | { kind: "offer"; requestId: string; offerId: string };

export function contextOf(view: Pick<ChatView, "dealId" | "requestId" | "offerId">): ChatContext {
  return view.dealId ? { kind: "deal", dealId: view.dealId } : { kind: "offer", requestId: view.requestId, offerId: view.offerId };
}

/**
 * Адрес и подпись ссылки «к чему относится»: сделка — у обеих сторон; до сделки покупателю — его предложение, мастеру —
 * заявка, по которой он предложил цену (экран заявки мастера).
 */
export function contextLink(context: ChatContext, title: string | null, side: DealSide = "CLIENT"): { href: string; label: string } {
  if (context.kind === "deal") {
    return { href: to(`/deals/${encodeURIComponent(context.dealId)}`), label: title ? t.room.aboutDeal(title) : t.room.aboutDealShort };
  }
  if (side === "EXECUTOR") {
    return { href: to(`/executor/requests/${encodeURIComponent(context.requestId)}`), label: title ? tm.room.aboutRequest(title) : tm.room.aboutRequestShort };
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

/** Адрес диалога (у обеих сторон один). */
export const chatHref = (offerId: string): string => to(`/chats/${encodeURIComponent(offerId)}`);

/**
 * Строки списка диалогов стороны: адрес — всегда экран диалога v2. Только диалоги с сообщениями: пустой диалог по
 * предложению открывается с экрана предложения (покупатель) или заявки (мастер). Модуль не отдаёт «непрочитанное» — признака нет.
 */
export function chatRows(items: readonly ChatListItem[], now: Date = new Date(), side: DealSide = "CLIENT"): ChatRowView[] {
  return items.filter((item) => item.lastMessage !== null).map((item) => ({
    offerId: item.offerId,
    href: chatHref(item.offerId),
    counterpart: counterpartOf(item.counterpart, side),
    title: item.title,
    last: item.lastMessage ?? "",
    time: item.lastAt ? formatRelative(item.lastAt, now) : null,
    closed: item.closed,
  }));
}
