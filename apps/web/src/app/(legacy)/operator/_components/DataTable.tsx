import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "@/ui";

/** Ячейка заголовка столбца: мелкая серая подпись в одну строку. */
export const TH = "px-4 py-3 text-left align-bottom text-sm font-semibold whitespace-nowrap text-muted";
/** Заголовок строки (первый столбец): обычный вес, как ячейка. */
export const TH_ROW = "px-4 py-3 text-left align-top font-normal";
/** Ячейка данных. */
export const TD = "px-4 py-3 align-top";
/**
 * Минимальная ширина столбца с длинным текстом — не больше доли окна: при 320 px и шрифте 200 % первый столбец
 * помещается на экран, а не уезжает за край области прокрутки. WIDE — первый столбец (сделка, исполнитель).
 */
export const COL_WIDE = "min-w-[min(14rem,70vw)]";
export const COL_MID = "min-w-[min(12rem,60vw)]";
export const COL_NARROW = "min-w-[min(9rem,50vw)]";
/** Ячейка с суммой или числом: справа, цифры одной ширины, без переноса. */
export const TD_NUM = "px-4 py-3 text-right align-top whitespace-nowrap tabular-nums";

export type DataTableProps = {
  /** Подпись таблицы (caption) — её имя для диктора; из ru. */
  caption: string;
  /** Подпись только для диктора, когда заголовок страницы говорит то же самое. */
  hideCaption?: boolean;
  /** thead, tbody, tfoot. */
  children: ReactNode;
  className?: string;
};

/**
 * Таблица оператора (десктоп-первый экран) в белой карточке. Широкая таблица на телефоне прокручивается вбок внутри
 * своей области, а не вся страница: область — именованный регион с tabIndex=0, чтобы с клавиатуры её можно было
 * выбрать и прокрутить стрелками.
 */
export function DataTable({ caption, hideCaption = false, children, className }: DataTableProps) {
  return (
    <div
      role="region"
      aria-label={ru.common.ui.tableRegion(caption)}
      tabIndex={0}
      className={cn(
        "min-w-0 overflow-x-auto rounded-card border border-line bg-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
    >
      <table className="w-full border-collapse text-base text-ink [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tfoot_tr]:border-t-2 [&_tfoot_tr]:border-line-strong">
        <caption className={hideCaption ? "sr-only" : "px-4 pt-4 text-left text-xl font-bold text-ink"}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
