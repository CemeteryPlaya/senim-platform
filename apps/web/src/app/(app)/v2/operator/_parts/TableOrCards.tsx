import type { ReactNode } from "react";
import { Card, cn, DataTable, EmptyState, KeyValueList, type DataTableProps } from "@/kit";

export type TableOrCardsProps<Row> = DataTableProps<Row> & {
  /**
   * Телефон: одна карточка-список, строка «заголовок — значения справа» (статус — 4 — 2 755 000 ₸). Для таблиц из 1–2
   * коротких столбцов кроме заголовка: отдельная карточка с подписью над каждым числом раздувала экран. Подписи столбцов
   * остаются для диктора (`sr-only`).
   */
  compact?: boolean;
  /**
   * Телефон: ключи столбцов, которые попадают в карточку (заголовок строки — всегда). Для широких таблиц: остальное —
   * в записи по ссылке заголовка. Без списка — все столбцы.
   */
  phoneKeys?: readonly string[];
};

type Cell = { key: string; header: string; value: ReactNode };

/** Строка компактного списка: заголовок слева, значения справа; не помещаются — переносятся под заголовок. */
function CompactRow({ head, cells, total = false }: { head: ReactNode; cells: readonly Cell[]; total?: boolean }) {
  return (
    <li className={cn("flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t px-card py-3 text-body text-ink first:border-t-0", total ? "border-line-strong font-semibold" : "border-line")}>
      <span className="min-w-0 wrap-break-word">{head}</span>
      <span className="ml-auto flex flex-wrap items-baseline justify-end gap-x-4 tabular-nums">
        {cells.map((cell) => (
          <span key={cell.key}>
            <span className="sr-only">{cell.header}: </span>
            {cell.value}
          </span>
        ))}
      </span>
    </li>
  );
}

/**
 * Таблица на компьютере, карточки на телефоне: суммы не прячутся за прокруткой внутри таблицы. Те же столбцы и ячейки:
 * столбец-заголовок строки (`rowHeader`) становится заголовком карточки, остальные — списком «подпись — значение» (короткие
 * значения — в строку с подписью, `KeyValueList inline`); строка итога (`footer`) — последней карточкой. `compact` — одна
 * карточка со строками вместо карточки на строку; `phoneKeys` — какие столбцы видны на телефоне. Версия по устройству
 * (`mobile:` / `desktop:`): не по ширине окна. Строк нет — один пустой экран.
 */
export function TableOrCards<Row>({ compact = false, phoneKeys, ...props }: TableOrCardsProps<Row>) {
  const { columns, rows, rowKey, footer, empty, caption } = props;
  if (rows.length === 0) return <EmptyState title={empty.title} body={empty.body} {...(empty.action ? { action: empty.action } : {})} />;
  const head = columns.find((column) => column.rowHeader) ?? columns[0];
  const rest = columns.filter((column) => column !== head && (phoneKeys === undefined || phoneKeys.includes(column.key)));
  const footerRow = footer && head ? footer : undefined;
  return (
    <>
      <div className="mobile:hidden">
        <DataTable {...props} />
      </div>
      {compact ? (
        <div className="desktop:hidden">
          <Card padded={false}>
            <ul aria-label={caption} className="m-0 list-none p-0">
              {rows.map((row) => (
                <CompactRow key={rowKey(row)} head={head?.cell(row)} cells={rest.map((column) => ({ key: column.key, header: column.header, value: column.cell(row) }))} />
              ))}
              {footerRow && head && (
                <CompactRow
                  total
                  head={footerRow[head.key]}
                  cells={rest.filter((column) => footerRow[column.key] !== undefined).map((column) => ({ key: column.key, header: column.header, value: footerRow[column.key] }))}
                />
              )}
            </ul>
          </Card>
        </div>
      ) : (
        <ul aria-label={caption} className="m-0 flex list-none flex-col gap-stack-group p-0 desktop:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)}>
              <Card padded={false}>
                {head && <div className="px-card pt-3 pb-1 text-body font-medium wrap-break-word text-ink">{head.cell(row)}</div>}
                <KeyValueList inline items={rest.map((column) => ({ label: column.header, value: column.cell(row) }))} />
              </Card>
            </li>
          ))}
          {footerRow && head && (
            <li>
              <Card padded={false}>
                <div className="px-card pt-3 pb-1 text-body font-semibold text-ink">{footerRow[head.key]}</div>
                <KeyValueList
                  inline
                  items={rest.filter((column) => footerRow[column.key] !== undefined).map((column) => ({ label: column.header, value: <span className="font-semibold">{footerRow[column.key]}</span> }))}
                />
              </Card>
            </li>
          )}
        </ul>
      )}
    </>
  );
}
