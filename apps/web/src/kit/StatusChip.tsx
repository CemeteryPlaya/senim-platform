import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatusTone = "accent" | "neutral" | "warn" | "danger";

/**
 * Заливка и текст по тону (разбор 3.6): нейтральный — информационный статус («Идёт сделка», «В работе», «Опубликована»),
 * заливка fill и текст ink (muted на fill тоже прошёл бы, но статус — не вторичный текст); warn — от человека нужно
 * действие; accent — только деньги под защитой и завершённая сделка (зелёный — деньгам и прогрессу, разбор 2, раздел 5
 * п. 7); danger — спор, отказ. Все пары — в contrast.test.ts.
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
 * Статус сделки или заявки: в одну строку — капсула высотой 28 px (на компьютере 26 px), текст 15 px / 500, слева точка
 * 8 px цвета состояния. Точка — украшение (скрыта от диктора): смысл несёт подпись.
 *
 * Перенос (крупный шрифт, узкое место; разбор 2, 3.7 и раздел 5 п. 5): чип по подписи (`w-fit`: в колонке не
 * растягивается во всю ширину) и не шире строки (`max-w-full`), подпись переносится по словам, а форма — не «облако»:
 * радиус 14 px в px (`rounded-status`) — у строки 28 px это капсула, у двух строк и при шрифте 200 % — скруглённый
 * прямоугольник. Боковые поля — 12 px в px (`px-chip-x`): при 200 % не съедают ширину подписи. Точка стоит у первой
 * строки (обёртка высотой в строку `h-lh`), высота строки — полями сверху и снизу (`py-chip-y`: 28 px минус строка,
 * пополам). Если у всех строк списка один статус — не показывайте его в строке (вынесите в заголовок фильтра).
 * Серверный компонент.
 */
export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      data-status-chip
      className={cn(
        "inline-flex w-fit max-w-full items-start gap-1.5 rounded-status px-chip-x py-chip-y text-sub font-medium desktop:py-chip-y-desktop",
        TONES[tone],
      )}
    >
      <span aria-hidden className="flex h-lh shrink-0 items-center">
        <span className={cn("size-2 rounded-full", DOTS[tone])} />
      </span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}
