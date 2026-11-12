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
