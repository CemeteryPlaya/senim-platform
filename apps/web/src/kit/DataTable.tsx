import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";
import { EmptyState } from "./EmptyState";

export type DataTableColumn<Row> = {
  /** Ключ столбца (уникальный в таблице): ключ React и ячейки итога (`footer`). */
  key: string;
  /** Заголовок столбца (`<th scope="col">`). */
  header: string;
  /** Содержимое ячейки: текст, ссылка, `StatusChip`, `<Money>`. Ничего не считается здесь. */
  cell: (row: Row) => ReactNode;
  /** Заголовок строки (`<th scope="row">`): обычно первый столбец — сделка, исполнитель. Диктор называет его у каждой ячейки строки. */
  rowHeader?: boolean;
  /** Число или сумма: по правому краю, табличные цифры, без переноса. */
  numeric?: boolean;
  /** Нижняя граница ширины столбца с длинным текстом: `wide` — первый столбец, `mid`, `narrow`. Без неё столбец по содержимому. */
  width?: "wide" | "mid" | "narrow";
};

export type DataTableProps<Row> = {
  /** Подпись таблицы (`<caption>`) — её имя для диктора и имя области прокрутки. */
  caption: string;
  /** Подпись только для диктора: заголовок экрана или раздела уже говорит то же самое. */
  captionHidden?: boolean;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  /** Ключ строки (id записи). */
  rowKey: (row: Row) => string;
  /** Строка итога (`<tfoot>`): содержимое по ключу столбца; столбцы без значения — пустые ячейки. */
  footer?: Readonly<Partial<Record<string, ReactNode>>>;
  /** Строк нет — вместо таблицы обучающий пустой экран (`EmptyState`). */
  empty: { title: string; body: string; action?: { href: string; label: string } };
};

const WIDTH = { wide: "min-w-col-wide", mid: "min-w-col-mid", narrow: "min-w-col-narrow" } as const;

/** Поля ячейки: 16 px по бокам (как у карточки и строки списка), 12 px сверху и снизу. */
const CELL = "px-card py-3 align-top";

function cellClass<Row>(column: DataTableColumn<Row>): string {
  return cn(CELL, column.numeric ? "text-right whitespace-nowrap tabular-nums" : "text-left wrap-break-word", column.width && WIDTH[column.width]);
}

/**
 * Таблица оператора (экраны «Сделки», «Исполнители», «Споры», отчёты): белая подложка карточки без рамки, заголовки
 * столбцов вторичным текстом 15 px, строки через тонкую линию, суммы — справа табличными цифрами.
 *
 * Доступность: `<caption>` (видимая или только для диктора), `<th scope="col">` у столбцов и `<th scope="row">` у
 * столбца-заголовка строки. Широкая таблица (узкое окно компьютера, телефон 320 px, шрифт 200 %) прокручивается вбок
 * ВНУТРИ своей области, а не вся страница: область — именованный регион («Таблица «Сделки»») с `tabIndex=0`, его можно
 * выбрать с клавиатуры и прокрутить стрелками. Столбцы с длинным текстом не уже доли окна (`width`), поэтому первый столбец
 * помещается в область прокрутки и переносится по словам.
 *
 * Строк нет — обучающий пустой экран вместо пустой сетки. Серверный компонент: данные и ссылки приходят готовыми.
 */
export function DataTable<Row>({ caption, captionHidden = false, columns, rows, rowKey, footer, empty }: DataTableProps<Row>) {
  if (rows.length === 0) return <EmptyState title={empty.title} body={empty.body} action={empty.action} />;
  return (
    <div role="region" aria-label={ru.app.kit.table.region(caption)} tabIndex={0} data-table-region className="max-w-full min-w-0 overflow-x-auto rounded-card bg-surface">
      <table className="w-full border-collapse text-body text-ink">
        <caption className={captionHidden ? "sr-only" : "px-card pt-4 pb-1 text-left text-headline text-ink"}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn("px-card py-3 align-bottom text-sub font-medium whitespace-nowrap text-muted", column.numeric ? "text-right" : "text-left")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-line">
              {columns.map((column) =>
                column.rowHeader ? (
                  <th key={column.key} scope="row" className={cn(cellClass(column), "font-normal")}>
                    {column.cell(row)}
                  </th>
                ) : (
                  <td key={column.key} className={cellClass(column)}>
                    {column.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-line-strong font-semibold">
              {columns.map((column) =>
                column.rowHeader ? (
                  <th key={column.key} scope="row" className={cn(cellClass(column), "font-semibold")}>
                    {footer[column.key]}
                  </th>
                ) : (
                  <td key={column.key} className={cellClass(column)}>
                    {footer[column.key]}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
