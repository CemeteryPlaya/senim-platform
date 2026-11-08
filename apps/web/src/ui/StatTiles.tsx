import { cn } from "./cn";

export type StatTileItem = { label: string; value: string; hint?: string };

/** Сводка плитками («Новые заявки», «В работе»): крупное число, подпись, необязательная подсказка. */
export function StatTiles({ items, className }: { items: readonly StatTileItem[]; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface p-4">
          <span className="text-3xl leading-tight font-extrabold text-ink tabular-nums">{item.value}</span>
          <span className="text-base text-ink-soft">{item.label}</span>
          {item.hint && <span className="text-sm text-muted">{item.hint}</span>}
        </li>
      ))}
    </ul>
  );
}
