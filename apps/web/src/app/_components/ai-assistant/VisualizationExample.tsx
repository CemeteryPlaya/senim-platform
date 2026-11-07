import { ArrowRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import { StatusBadge } from "@/ui";

const t = ru.ai.visualization;

/** Схематичная комната: стены, окно, пол. Цвета — токены темы. */
function Room({ children }: { children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 320 200" className="aspect-[16/10] w-full rounded-control bg-sunken" aria-hidden>
      <rect x="0" y="0" width="320" height="150" style={{ fill: "var(--color-surface, #ffffff)" }} />
      <rect x="0" y="150" width="320" height="50" style={{ fill: "var(--color-line, #e2e5e2)" }} />
      <rect x="230" y="30" width="60" height="70" rx="4" strokeWidth="2" style={{ fill: "var(--color-info-soft, #e7eff7)", stroke: "var(--color-line-strong, #858c88)" }} />
      <line x1="260" y1="30" x2="260" y2="100" strokeWidth="2" style={{ stroke: "var(--color-line-strong, #858c88)" }} />
      {children}
    </svg>
  );
}

function Cabinets() {
  const doors = [20, 60, 100, 140, 180];
  return (
    <g>
      {doors.map((x) => (
        <rect key={`top-${x}`} x={x} y="28" width="36" height="46" rx="3" strokeWidth="2" style={{ fill: "var(--color-accent-soft, #e6f0eb)", stroke: "var(--color-primary, #0f5b44)" }} />
      ))}
      <rect x="14" y="104" width="214" height="8" style={{ fill: "var(--color-line-strong, #858c88)" }} />
      {doors.map((x) => (
        <rect key={`base-${x}`} x={x} y="112" width="36" height="52" rx="3" strokeWidth="2" style={{ fill: "var(--color-accent-soft, #e6f0eb)", stroke: "var(--color-primary, #0f5b44)" }} />
      ))}
    </g>
  );
}

/** Пример «до → после» из макета 781: показывает, что получится, пока своих иллюстраций нет. */
export function VisualizationExample() {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-base font-medium text-ink">{t.exampleTitle}</figcaption>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex flex-col gap-1" role="img" aria-label={t.exampleBeforeAlt}>
          <Room />
          <span className="text-sm text-muted">{t.exampleBefore}</span>
        </div>
        <ArrowRight aria-hidden className="size-6 text-primary" />
        <div className="flex flex-col gap-1" role="img" aria-label={t.exampleAfterAlt}>
          <Room>
            <Cabinets />
          </Room>
          <StatusBadge tone="accent">{t.exampleAfter}</StatusBadge>
        </div>
      </div>
    </figure>
  );
}
