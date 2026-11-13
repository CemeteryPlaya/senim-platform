import type { MeasurementStatus, OfferStatus, RequestStatus } from "@/generated/prisma/enums";
import type { Tone } from "@/ui";

// Группы заявок и текст условий замера — чистая логика, живёт в src/features/requests.
export { groupOf, REQUEST_GROUP, REQUEST_GROUPS, termsText, type RequestGroup } from "@/features/requests/labels";

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
