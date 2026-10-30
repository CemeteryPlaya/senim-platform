import type { DealStatus, OfferStatus, RequestStatus } from "@/generated/prisma/enums";

/**
 * Можно ли писать в чат отклика (ADR-003: чат начинается с отклика и продолжается в сделке).
 * Читать историю могут всегда — стороны и оператор; закрывается только запись.
 * После завершённой сделки чат открыт: стороны обсуждают гарантию.
 */
export type ChatState = { offerStatus: OfferStatus; requestStatus: RequestStatus; dealStatus: DealStatus | null };

export type ChatClosedReason = "offerWithdrawn" | "offerDeclined" | "requestCancelled" | "dealCancelled" | "dealTerminated";

export function chatClosedReason(state: ChatState): ChatClosedReason | null {
  if (state.dealStatus === "CANCELLED") return "dealCancelled";
  if (state.dealStatus === "TERMINATED") return "dealTerminated";
  if (state.offerStatus === "WITHDRAWN") return "offerWithdrawn";
  if (state.offerStatus === "DECLINED") return "offerDeclined";
  if (state.requestStatus === "CANCELLED") return "requestCancelled";
  return null;
}
