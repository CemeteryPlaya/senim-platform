import { Card, DataTable, EmptyState, KeyValueList, type DataTableProps } from "@/kit";

/**
 * Таблица на компьютере, карточки на телефоне: суммы не прячутся за прокруткой внутри таблицы. Те же столбцы и ячейки:
 * столбец-заголовок строки (`rowHeader`) становится заголовком карточки, остальные — списком «подпись — значение»;
 * строка итога (`footer`) — последней карточкой. Версия по устройству (`mobile:` / `desktop:`): не по ширине окна.
 * Строк нет — один пустой экран.
 */
export function TableOrCards<Row>(props: DataTableProps<Row>) {
  const { columns, rows, rowKey, footer, empty, caption } = props;
  if (rows.length === 0) return <EmptyState title={empty.title} body={empty.body} {...(empty.action ? { action: empty.action } : {})} />;
  const head = columns.find((column) => column.rowHeader) ?? columns[0];
  const rest = columns.filter((column) => column !== head);
  return (
    <>
      <div className="mobile:hidden">
        <DataTable {...props} />
      </div>
      <ul aria-label={caption} className="m-0 flex list-none flex-col gap-stack-group p-0 desktop:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <Card padded={false}>
              {head && <div className="px-card pt-3 pb-1 text-body font-medium wrap-break-word text-ink">{head.cell(row)}</div>}
              <KeyValueList items={rest.map((column) => ({ label: column.header, value: column.cell(row) }))} />
            </Card>
          </li>
        ))}
        {footer && head && (
          <li>
            <Card padded={false}>
              <div className="px-card pt-3 pb-1 text-body font-semibold text-ink">{footer[head.key]}</div>
              <KeyValueList items={rest.filter((column) => footer[column.key] !== undefined).map((column) => ({ label: column.header, value: <span className="font-semibold">{footer[column.key]}</span> }))} />
            </Card>
          </li>
        )}
      </ul>
    </>
  );
}
