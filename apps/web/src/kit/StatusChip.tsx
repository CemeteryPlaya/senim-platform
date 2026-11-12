import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatusTone = "accent" | "neutral" | "warn" | "danger";

const TONES: Record<StatusTone, string> = {
  accent: "bg-accent-soft text-accent",
  neutral: "bg-canvas text-muted",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

/** Статус сделки или заявки: небольшая плашка, цвет только по смыслу. */
export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-chip px-2 py-1 text-sub font-medium", TONES[tone])}>
      {children}
    </span>
  );
}
