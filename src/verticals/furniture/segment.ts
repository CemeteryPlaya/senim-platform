import type { Segment } from "@/generated/prisma/enums";
import { COUNTERTOPS, FACADES, HARDWARE, type CountertopKey, type FacadeKey, type HardwareKey } from "./catalog";

export type SegmentInput = {
  facade?: FacadeKey | null;
  countertop?: CountertopKey | null;
  hardware?: HardwareKey | null;
  widthCm?: number | null;
};

export type SegmentSuggestion = {
  segment: Segment | null;
  /** Объяснение для кнопки «Почему?». */
  reasons: string[];
};

const rank: Record<Segment, number> = { ECONOMY: 0, COMFORT: 1, PREMIUM: 2 };
const LARGE_WIDTH_CM = 450;

/**
 * Подсказка сегмента по материалам и размерам. Сегмент определяет самый дорогой признак.
 * Это подсказка заказчику, а не цена: окончательно сегмент выбирает заказчик.
 */
export function suggestSegment(input: SegmentInput): SegmentSuggestion {
  const signals: { segment: Segment; reason: string }[] = [];
  if (input.facade) {
    const f = FACADES[input.facade];
    signals.push({ segment: f.segment, reason: `Фасады: ${f.name.toLowerCase()} — ${f.segmentNote}` });
  }
  if (input.countertop) {
    const c = COUNTERTOPS[input.countertop];
    signals.push({ segment: c.segment, reason: `Столешница: ${c.name.toLowerCase()} — ${c.segmentNote}` });
  }
  if (input.hardware) {
    const h = HARDWARE[input.hardware];
    signals.push({ segment: h.segment, reason: `Фурнитура: ${h.name.toLowerCase()} — ${h.segmentNote}` });
  }
  if (signals.length === 0) return { segment: null, reasons: [] };

  let segment = signals.reduce<Segment>((top, s) => (rank[s.segment] > rank[top] ? s.segment : top), "ECONOMY");
  const reasons = signals.map((s) => s.reason);
  if (input.widthCm && input.widthCm >= LARGE_WIDTH_CM && segment === "ECONOMY") {
    segment = "COMFORT";
    reasons.push(`Длина ${input.widthCm} см — большой объём работы, обычно это уровень «Комфорт»`);
  }
  return { segment, reasons };
}
