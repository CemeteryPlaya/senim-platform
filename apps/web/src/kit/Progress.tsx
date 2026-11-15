import { ru } from "@/i18n/ru";

export type ProgressProps = {
  value: number;
  max: number;
  label: string;
  /**
   * Шаги делениями (ход сделки, разбор 3.8): `max` отрезков через зазор 4 px, пройденные залиты, у текущего — начальная
   * заливка на треть: шаг 1 из 5 не выглядит пустой (сломанной) полосой. Только для целого числа шагов до 12; иначе —
   * сплошная полоса.
   */
  segmented?: boolean;
};

/** Больше делений полоса не делит: отрезки стали бы точками. */
const MAX_SEGMENTS = 12;

/** Полоса прогресса (шаги сделки), 6 px со скруглением. Нет смысла (`max <= 0`, не число) — ничего не рисуется. */
export function Progress({ value, max, label, segmented = false }: ProgressProps) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  const now = Math.min(Math.max(value, 0), max);
  const aria = {
    role: "progressbar",
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": max,
    "aria-valuenow": now,
    "aria-valuetext": ru.app.kit.progress(now, max),
  } as const;
  if (segmented && Number.isInteger(max) && max <= MAX_SEGMENTS) {
    const done = Math.floor(now);
    return (
      <div {...aria} data-segmented className="flex h-progress w-full gap-1">
        {Array.from({ length: max }, (_, index) => (
          <div key={index} className="h-full min-w-0 flex-1 overflow-hidden rounded-full bg-line">
            {index < done && <div className="h-full w-full bg-accent" />}
            {index === done && <div data-current-step className="h-full w-1/3 rounded-full bg-accent" />}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div {...aria} className="h-progress w-full overflow-hidden rounded-full bg-line">
      {/* Прямоугольная заливка: масштаб по X (только transform) не растягивает скругление трека. */}
      <div className="h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${now / max})` }} />
    </div>
  );
}
