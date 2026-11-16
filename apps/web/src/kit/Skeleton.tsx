import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

/** Заготовка строк текста, пока грузятся данные. Без мерцания: статичная, диктор слышит «Загрузка». */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">{ru.app.kit.loading}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          aria-hidden
          data-skeleton-line
          className={cn("h-4 rounded-chip bg-line", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Плашка каркаса (строка, заголовок, чип, круг): заливка `fill`, мягкая пульсация прозрачностью (feedback.css). */
function Bar({ className }: { className: string }) {
  return <span aria-hidden data-skeleton-bar className={cn("skeleton-bar block shrink-0", className)} />;
}

/** Строки текста: последняя короче — так каркас читается как абзац, а не как таблица. */
function Lines({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <Bar key={i} className={cn("h-4 rounded-chip", i === count - 1 && count > 1 ? "w-2/3" : "w-full")} />
  ));
}

export type SkeletonScreenProps = {
  /** Части каркаса (`SkeletonTitle`, `SkeletonCard`, `SkeletonRows`, `SkeletonChips`), можно в `Split`. */
  children: ReactNode;
  /** Раскладка экрана, если она не колонка с зазором раздела (ширина колонки, сетка двух панелей на компьютере). */
  className?: string;
};

/**
 * Каркас экрана, пока грузится маршрут (`loading.tsx`): повторяет раскладку экрана плашками без текста. Диктор слышит
 * «Загрузка» (`role="status"`, `aria-busy`), сами плашки скрыты. Без мигания на быстрой сети: каркас проявляется через
 * 300 мс (`skeleton-screen`, CSS) — если экран пришёл раньше, каркаса не видно. Плашки пульсируют прозрачностью; при
 * `prefers-reduced-motion` — статичные. Заголовка `<h1>` в каркасе нет: его даст сам экран. Серверный компонент.
 */
export function SkeletonScreen({ children, className }: SkeletonScreenProps) {
  return (
    <div role="status" aria-busy="true" data-skeleton-screen className={cn("skeleton-screen flex flex-col gap-stack-section", className)}>
      <span className="sr-only">{ru.app.kit.loading}</span>
      {children}
    </div>
  );
}

export type SkeletonTitleProps = {
  /** Вложенный экран: строка «‹ Родитель» над заголовком. */
  back?: boolean;
  /** Строка-пояснение под заголовком («Сделка №6 · Исполнитель №3»). */
  lead?: boolean;
  /** Чип статуса под заголовком. */
  chip?: boolean;
};

/** Каркас заголовка экрана (`PageTitle`): высота строки `title` (34 px, на компьютере 40 px). */
export function SkeletonTitle({ back = false, lead = false, chip = false }: SkeletonTitleProps) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {back && <Bar className="h-6 w-24 rounded-chip" />}
      <Bar className="h-9 w-1/2 rounded-field desktop:h-11 desktop:w-1/3" />
      {lead && <Bar className="h-5 w-2/3 rounded-chip desktop:w-1/3" />}
      {chip && <Bar className="h-7 w-40 rounded-status" />}
    </div>
  );
}

/** Каркас ряда чипов-фильтров (`Chips`, `Segmented`): капсулы 48 px (на компьютере 36 px). */
export function SkeletonChips({ count = 2 }: { count?: number }) {
  return (
    <div aria-hidden className="flex gap-2">
      {Array.from({ length: count }, (_, i) => (
        <Bar key={i} className="h-12 w-28 rounded-chip desktop:h-9" />
      ))}
    </div>
  );
}

export type SkeletonCardProps = {
  /** Строк текста под заголовком карточки. */
  lines?: number;
  /** Заголовок карточки (`headline`). */
  headline?: boolean;
  /** Фото 16 : 9 сверху (карточка работы, обложка сделки). */
  photo?: boolean;
};

/** Каркас карточки (`Card`): поверхность `surface`, радиус карточки, отступ 16 px. */
export function SkeletonCard({ lines = 2, headline = true, photo = false }: SkeletonCardProps) {
  return (
    <div aria-hidden data-skeleton-card className="flex flex-col gap-3 rounded-card bg-surface p-card">
      {photo && <Bar className="aspect-16/9 w-full rounded-photo" />}
      {headline && <Bar className="h-5 w-2/5 rounded-chip" />}
      <Lines count={lines} />
    </div>
  );
}

export type SkeletonRowsProps = {
  /** Строк в списке. */
  rows?: number;
  /** Круг слева (монограмма, миниатюра) — строка 56 px. */
  leading?: boolean;
};

/** Каркас сгруппированного списка (`Card variant="grouped"` + `ListRow`): строки с разделением, без шевронов. */
export function SkeletonRows({ rows = 3, leading = false }: SkeletonRowsProps) {
  return (
    <div aria-hidden className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
          {leading && <Bar className="size-11 rounded-full" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bar className="h-4 w-1/2 rounded-chip" />
            <Bar className="h-4 w-4/5 rounded-chip" />
          </div>
        </div>
      ))}
    </div>
  );
}
