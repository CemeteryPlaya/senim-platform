import type { CSSProperties } from "react";
import { ru } from "@/i18n/ru";
import { barPercents } from "./bars-logic";
import { cn } from "./cn";
import { Money } from "./Money";

export type BarItem = {
  /** Подпись столбика («Ноя»). */
  label: string;
  /** Полное имя для диктора и таблицы («Ноябрь 2026»); по умолчанию `label`. */
  name?: string;
  /** Сумма в тиынах, целая. */
  value: bigint;
  /** Выделенный столбик (текущий месяц): зелёный и жирнее подпись. Обычно один. */
  current?: boolean;
};

export type BarsProps = {
  /** Что показано («Выплаты по месяцам»): имя графика для диктора и подпись таблицы-дубля. */
  label: string;
  items: readonly BarItem[];
  /**
   * `"rows"` (по умолчанию) — строки «подпись — полоса — сумма» на любом устройстве; суммы никогда не наезжают друг на друга.
   * `"columns"` — на компьютере вертикальные столбики с суммой над ними; нужна ширина не меньше ~90 px на столбик при
   * суммах в миллионы (на телефоне всё равно строки). Для колонки уже ~35 rem не используйте.
   */
  layout?: "rows" | "columns";
};

/**
 * Столбики сумм (выплаты по месяцам) без библиотек графиков. Суммы — через `Money`. Текущий месяц — `accent`, остальные
 * нейтральные (зелёный — для денег). Сам рисунок скрыт от диктора (`aria-hidden`), вместо него — таблица «Месяц — Сумма»
 * с пометкой текущего (`sr-only`). Доля заливки — переменная `--bar` (процент от максимума), утилита `bar-fill` в
 * tokens.css. Серверный компонент.
 */
export function Bars({ label, items, layout = "rows" }: BarsProps) {
  const t = ru.app.kit.bars;
  const columns = layout === "columns";
  const percents = barPercents(items.map((item) => item.value));
  return (
    <figure className="m-0 flex flex-col gap-3">
      <ul aria-hidden className={cn("m-0 flex list-none flex-col gap-3 p-0", columns && "desktop:flex-row desktop:items-end desktop:gap-4")}>
        {items.map((item, index) => (
          <li
            key={`${index}-${item.label}`}
            className={cn("flex items-center gap-3", columns && "desktop:min-w-0 desktop:flex-1 desktop:basis-0 desktop:flex-col-reverse desktop:items-stretch desktop:gap-2")}
          >
            <span className={cn("w-14 shrink-0 text-sub", columns && "desktop:w-auto desktop:text-center", item.current ? "font-semibold text-ink" : "text-muted")}>
              {item.label}
            </span>
            <span className={cn("flex min-w-0 flex-1 items-center gap-3", columns && "desktop:h-40 desktop:flex-none desktop:flex-col desktop:items-stretch desktop:justify-end desktop:gap-2")}>
              <span className={cn("order-last ml-auto text-sub whitespace-nowrap tabular-nums", columns && "desktop:order-first desktop:ml-0 desktop:text-center", item.current && "font-semibold")}>
                <Money tiyn={item.value} />
              </span>
              <span className={cn("flex h-3 flex-1 rounded-chip bg-line", columns && "desktop:h-auto desktop:min-h-0 desktop:items-end")}>
                <span className={cn("bar-fill", columns && "desktop:bar-fill-v", item.current ? "bg-accent" : "bg-line-strong")} style={{ "--bar": `${percents[index] ?? 0}%` } as CSSProperties} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{t.month}</th>
            <th scope="col">{t.amount}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${index}-${item.label}`}>
              <th scope="row">{item.current ? `${item.name ?? item.label}, ${t.current}` : (item.name ?? item.label)}</th>
              <td>
                <Money tiyn={item.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
