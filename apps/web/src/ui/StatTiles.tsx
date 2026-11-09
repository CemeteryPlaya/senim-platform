import { Fragment } from "react";
import { cn } from "./cn";
import { digitGroupParts } from "./format";

export type StatTileItem = {
  label: string;
  /** Число или сумма строкой (formatTiyn): перенос — только между группами разрядов, «₸» не отрывается. */
  value: string;
  hint?: string;
  /** Только на десктопе (≥ 1024 px): на телефоне сводка короче (макет master-screens, «Заработок за месяц»). */
  desktopOnly?: boolean;
};

/** Сводка плитками («Новые заявки», «В работе»): крупное число, подпись, необязательная подсказка. */
export function StatTiles({ items, label, className }: { items: readonly StatTileItem[]; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))] gap-3", className)}>
      {items.map((item) => (
        <li
          key={item.label}
          className={cn("@container/tile flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface p-4", item.desktopOnly && "max-lg:hidden")}
        >
          {/* tabular-nums — без переноса посреди группы (globals.css); <wbr> — места переноса между группами.
              Очень узкая плитка (320 px при шрифте 200 %) — число на ступень меньше: «000 ₸» помещается в строку. */}
          <span className="text-3xl leading-tight font-extrabold text-ink tabular-nums @max-[6em]/tile:text-2xl">
            {digitGroupParts(item.value).map((part, i) => (
              <Fragment key={i}>
                {i > 0 && <wbr />}
                {part}
              </Fragment>
            ))}
          </span>
          <span className="text-base text-ink-soft">{item.label}</span>
          {item.hint && <span className="text-sm text-muted">{item.hint}</span>}
        </li>
      ))}
    </ul>
  );
}
