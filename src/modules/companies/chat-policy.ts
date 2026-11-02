import type { DealStatus, OfferStatus, RequestStatus, Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";

/**
 * Можно ли писать в чат отклика (ADR-003: чат начинается с отклика и продолжается в сделке).
 * Читать историю могут всегда — стороны и оператор; закрывается только запись.
 * После завершённой сделки чат открыт: стороны обсуждают гарантию. Закрывает его оператор (ответ №19).
 */
/** Сторона чата отклика: заказчик заявки, исполнитель отклика или оператор (только читает). */
export type ChatParty = "client" | "executor" | "operator";

export type ChatState = { offerStatus: OfferStatus; requestStatus: RequestStatus; dealStatus: DealStatus | null; closedByOperator: boolean };

export type ChatClosedReason = "operatorClosed" | "offerWithdrawn" | "offerDeclined" | "requestCancelled" | "dealCancelled" | "dealRefunded";

export function chatClosedReason(state: ChatState): ChatClosedReason | null {
  if (state.closedByOperator) return "operatorClosed";
  if (state.dealStatus === "CANCELLED") return "dealCancelled";
  if (state.dealStatus === "REFUNDED") return "dealRefunded";
  if (state.offerStatus === "WITHDRAWN") return "offerWithdrawn";
  if (state.offerStatus === "DECLINED") return "offerDeclined";
  if (state.requestStatus === "CANCELLED") return "requestCancelled";
  return null;
}

/** Закрытие чата оператором (№19): состояние — Offer.chatClosedAt (null — открыт). */
export type ChatModerationState = "OPEN" | "CLOSED";
export type ChatModerationAction = "close" | "reopen";

export const CHAT_MODERATION = {
  close: { from: "OPEN", to: "CLOSED", who: "OPERATOR" },
  reopen: { from: "CLOSED", to: "OPEN", who: "OPERATOR" },
} as const satisfies Record<ChatModerationAction, { from: ChatModerationState; to: ChatModerationState; who: Role }>;

/** Куда ведёт действие; чужая роль — FORBIDDEN, не то состояние (повтор, двойной клик) — CONFLICT. */
export function moderationTarget(action: ChatModerationAction, from: ChatModerationState, who: Role): ChatModerationState {
  const rule = CHAT_MODERATION[action];
  if (who !== rule.who) return fail.forbidden();
  if (from !== rule.from) return fail.conflict(ru.companies.chat.moderation.errors[action]);
  return rule.to;
}
