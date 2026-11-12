import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatusTone = "accent" | "neutral" | "warn" | "danger";

/**
 * Нейтральный чип — на подложке line; текст ink, а не muted: muted на line в светлой теме даёт 4,0:1 (ниже 4,5:1,
 * пара ink/line — в contrast.test.ts).
 */
const TONES: Record<StatusTone, string> = {
  accent: "bg-accent-soft text-accent",
  neutral: "bg-line text-ink",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

/** Статус сделки или заявки: небольшая плашка 13 px / 600, отступы 4 × 8 px, радиус 6 px (.chip в эталонах). */
export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-chip px-2 py-1 text-small font-semibold", TONES[tone])}>
      {children}
    </span>
  );
}
