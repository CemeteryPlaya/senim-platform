import type { MeasurementStatus, MeasurementTerms, OfferStatus, RequestStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { formatMoney, type Tone } from "@/ui";

/** Тон метки статуса. Текст метки — из ru.requests.*Status; цвет не единственный носитель смысла. */
export const REQUEST_TONE: Record<RequestStatus, Tone> = {
  DRAFT: "neutral",
  PLATFORM_MEASURING: "accent",
  OPEN: "info",
  OFFER_CHOSEN: "accent",
  MEASURING: "accent",
  CONTRACTING: "warning",
  CLOSED: "success",
  CANCELLED: "neutral",
};

/** Разделы «Моих заявок» (чипы-фильтры): статус заявки → раздел. */
export const REQUEST_GROUPS = ["draft", "waiting", "chosen", "contract", "cancelled"] as const;
export type RequestGroup = (typeof REQUEST_GROUPS)[number];

export const REQUEST_GROUP: Record<RequestStatus, RequestGroup> = {
  DRAFT: "draft",
  PLATFORM_MEASURING: "waiting",
  OPEN: "waiting",
  OFFER_CHOSEN: "chosen",
  MEASURING: "chosen",
  CONTRACTING: "contract",
  CLOSED: "contract",
  CANCELLED: "cancelled",
};

/** Раздел из адреса (`?status=`): неизвестное значение — «Все». */
export function groupOf(value: string | undefined): RequestGroup | "all" {
  return REQUEST_GROUPS.find((g) => g === value) ?? "all";
}

export const OFFER_TONE: Record<OfferStatus, Tone> = {
  SENT: "info",
  WITHDRAWN: "neutral",
  DECLINED: "neutral",
  ACCEPTED: "success",
};

export const MEASUREMENT_TONE: Record<MeasurementStatus, Tone> = {
  SCHEDULED: "info",
  DONE: "success",
  NO_DEAL: "warning",
  CANCELLED: "neutral",
};

/** Условия замера одной строкой: «Замер бесплатно», «Выезд на замер 10 000 ₸, если…». */
export function termsText(terms: MeasurementTerms, fee: number | null): string {
  const t = ru.requests.terms;
  return terms === "FEE_IF_NO_DEAL" ? t.FEE_IF_NO_DEAL(formatMoney(fee ?? 0)) : t[terms];
}
