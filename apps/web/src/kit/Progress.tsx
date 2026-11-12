export type ProgressProps = { value: number; max: number; label: string };

/** Полоса прогресса (например, шаги сделки). Заполняется масштабом по X: анимируется только transform. */
export function Progress({ value, max, label }: ProgressProps) {
  const safeMax = max > 0 ? max : 1;
  const now = Math.min(Math.max(value, 0), safeMax);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={now}
      className="h-2 w-full overflow-hidden rounded-full bg-line"
    >
      <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${now / safeMax})` }} />
    </div>
  );
}
