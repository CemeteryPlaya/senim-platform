import { ru } from "@/i18n/ru";

export type ProgressProps = { value: number; max: number; label: string };

/** Полоса прогресса (шаги сделки), 6 px со скруглением. Нет смысла (`max <= 0`, не число) — ничего не рисуется. */
export function Progress({ value, max, label }: ProgressProps) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  const now = Math.min(Math.max(value, 0), max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
      aria-valuetext={ru.app.kit.progress(now, max)}
      className="h-progress w-full overflow-hidden rounded-full bg-line"
    >
      {/* Прямоугольная заливка: масштаб по X (только transform) не растягивает скругление трека. */}
      <div className="h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${now / max})` }} />
    </div>
  );
}
