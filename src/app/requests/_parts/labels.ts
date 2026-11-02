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

/** Картинки-примеры для плиток стиля и уровня (демо-иллюстрации из public/). */
export const STYLE_IMAGES: Record<string, string> = {
  modern: "/demo/portfolio/kitchen-sage.svg",
  minimalism: "/demo/portfolio/wardrobe-white.svg",
  scandi: "/demo/portfolio/tv-zone-scandi.svg",
  loft: "/demo/portfolio/shelving-loft.svg",
  neoclassic: "/demo/portfolio/kitchen-neoclassic.svg",
  classic: "/demo/portfolio/office-walnut.svg",
};

export const SEGMENT_IMAGES = {
  ECONOMY: "/demo/portfolio/wardrobe-oak.svg",
  COMFORT: "/demo/portfolio/kitchen-sage.svg",
  PREMIUM: "/demo/portfolio/kitchen-island-oak.svg",
} as const;
