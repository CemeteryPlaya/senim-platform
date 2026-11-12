import { Star } from "lucide-react";
import type { MeasurementTerms, Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { StatusBadge } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";

const t = ru.companies.executor;

/** Звезда и средняя оценка; для диктора — «Рейтинг 4,9 из 5», число отзывов — текстом рядом. */
export function Rating({ avg, count }: { avg: number; count: number }) {
  if (count === 0) return <span className="text-base text-muted">{t.ratingLabel(avg, count)}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-base">
      <Star aria-hidden className="size-5 shrink-0 fill-rating text-rating" />
      <span className="sr-only">{t.ratingLabel(avg, count)}</span>
      <span aria-hidden className="font-bold text-ink">
        {t.rating(avg)}
      </span>
      <span className="text-muted">({t.reviews(count)})</span>
    </span>
  );
}

export function SegmentBadge({ segment }: { segment: Segment | null }) {
  if (!segment) return <StatusBadge tone="neutral">{t.noSegment}</StatusBadge>;
  return <StatusBadge tone="accent">{SEGMENT_NAMES[segment]}</StatusBadge>;
}

export function measurementText(terms: MeasurementTerms, fee: number | null): string {
  return terms === "FEE_IF_NO_DEAL" ? t.measurement.FEE_IF_NO_DEAL(fee) : t.measurement[terms];
}
