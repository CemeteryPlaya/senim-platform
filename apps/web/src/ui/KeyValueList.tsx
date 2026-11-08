import type { ReactNode } from "react";
import { cn } from "./cn";

export type KeyValueRow = { label: string; value: ReactNode };

/** Список «метка — значение»: <dl>, строки с тонкими разделителями; метка и значение переносятся при крупном шрифте. */
export function KeyValueList({ rows, className }: { rows: readonly KeyValueRow[]; className?: string }) {
  return (
    <dl className={cn("flex flex-col divide-y divide-line", className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
          <dt className="text-base text-muted">{row.label}</dt>
          <dd className="min-w-0 text-base font-semibold text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
