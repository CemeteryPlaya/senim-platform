import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatusTone = "accent" | "neutral" | "warn" | "danger";

/**
 * Заливка и текст по тону (разбор 3.6): нейтральный — информационный статус («Идёт сделка», «Опубликована»), заливка
 * fill и текст ink (muted на fill тоже прошёл бы, но статус — не вторичный текст); warn — от человека нужно действие;
 * accent — деньги под защитой; danger — спор, отказ. Все пары — в contrast.test.ts.
 */
const TONES: Record<StatusTone, string> = {
  accent: "bg-accent-soft text-accent",
  neutral: "bg-fill text-ink",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

/** Точка состояния слева: цвет тона; у нейтрального — muted (информационный статус не кричит). */
const DOTS: Record<StatusTone, string> = {
  accent: "bg-accent",
  neutral: "bg-muted",
  warn: "bg-warn",
  danger: "bg-danger",
};

/**
 * Статус сделки или заявки: капсула высотой 28 px (на компьютере 26 px), текст 15 px / 500, слева точка 8 px цвета
 * состояния. Точка — украшение (скрыта от диктора): смысл несёт подпись. При крупном шрифте капсула растёт по высоте.
 * Если у всех строк списка один статус — не показывайте его в строке (вынесите в заголовок фильтра). Серверный компонент.
 */
export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      data-status-chip
      className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-chip px-3 text-sub font-medium desktop:min-h-6.5", TONES[tone])}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOTS[tone])} />
      {children}
    </span>
  );
}
