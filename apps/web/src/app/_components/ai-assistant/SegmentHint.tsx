"use client";

import { CircleHelp, Lightbulb } from "lucide-react";
import { useId, useState } from "react";
import { ru } from "@/i18n/ru";
import { SEGMENT_NAMES } from "@/verticals/furniture/catalog";
import { suggestSegment, type SegmentInput } from "@/verticals/furniture/segment";

export type SegmentHintProps = {
  /** Материалы и размеры из черновика заявки (поля «не знаю» не передавать). */
  details: SegmentInput;
};

const t = ru.ai.segment;

/**
 * Подсказка сегмента на шаге «Сегмент и отправка» (макет 752) с кнопкой «Почему?».
 * Считается правилами вертикали, а не ИИ, поэтому видна и при AI_ENABLED=false.
 */
export function SegmentHint({ details }: SegmentHintProps) {
  const { segment, reasons } = suggestSegment(details);
  const [open, setOpen] = useState(false);
  const reasonsId = useId();

  return (
    <section aria-labelledby={`${reasonsId}-title`} className="flex flex-col gap-3 rounded-card bg-accent-soft p-5">
      <div className="flex items-start gap-3">
        <Lightbulb aria-hidden className="mt-1 size-6 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={`${reasonsId}-title`} className="text-lg font-semibold text-primary">
            {t.title}
          </h2>
          <p className="text-base text-ink-soft" aria-live="polite">
            {segment ? (
              <>
                {t.recommend} <strong className="font-semibold text-ink">«{SEGMENT_NAMES[segment]}»</strong>. {t.alsoChoose}
              </>
            ) : (
              t.empty
            )}
          </p>
        </div>
      </div>
      {segment && (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={reasonsId}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-control-sm items-center gap-2 self-start rounded-full bg-surface px-4 text-base font-medium text-primary hover:bg-accent-soft-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <CircleHelp aria-hidden className="size-5" />
            {t.why}
          </button>
          <div id={reasonsId} hidden={!open} className="flex flex-col gap-2 rounded-control bg-surface p-4">
            <p className="text-base font-medium text-ink">{t.whyTitle}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-base text-ink-soft">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="text-sm text-muted">{t.note}</p>
          </div>
        </>
      )}
    </section>
  );
}
