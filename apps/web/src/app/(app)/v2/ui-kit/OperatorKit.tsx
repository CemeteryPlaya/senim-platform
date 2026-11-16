import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Card, DataTable, KeyValueList, Money, Narrow, Section, Stack, StatusChip, type DataTableColumn } from "@/kit";
import { QueueSample } from "./OperatorLive";

const s = ru.app.kit.showcase;
const t = s.operator;

/** Образец с подписью над ним. */
function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-muted">{label}</p>
      {children}
    </div>
  );
}

type Row = (typeof t.rows)[number];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "deal", header: t.columns.deal, cell: (row) => row.deal, rowHeader: true, width: "wide" },
  { key: "status", header: t.columns.status, cell: (row) => <StatusChip tone="neutral">{row.status}</StatusChip>, width: "narrow" },
  { key: "price", header: t.columns.price, cell: (row) => <Money tiyn={row.priceTiyn} />, numeric: true },
  { key: "updated", header: t.columns.updated, cell: (row) => row.updated, width: "narrow" },
];

const TOTAL = t.rows.reduce((sum, row) => sum + row.priceTiyn, 0n);

/** Образцы компонентов для экранов оператора: таблица (с итогом и пустая), «подпись — значение», очередь решений. */
export function OperatorKit() {
  return (
    <>
      <Section title={s.sections.table}>
        <Stack>
          <Specimen label={t.tableCaptionHint}>
            <DataTable
              caption={t.tableCaption}
              columns={COLUMNS}
              rows={t.rows}
              rowKey={(row) => row.id}
              footer={{ deal: t.total, price: <Money tiyn={TOTAL} /> }}
              empty={{ title: t.emptyTitle, body: t.emptyBody }}
            />
          </Specimen>
          <Specimen label={t.emptyCaption}>
            <DataTable caption={t.tableCaption} columns={COLUMNS} rows={[]} rowKey={(row) => row.id} empty={{ title: t.emptyTitle, body: t.emptyBody }} />
          </Specimen>
        </Stack>
      </Section>

      <Section title={s.sections.keyValue}>
        <Narrow>
          <Specimen label={t.keyValueLabel}>
            <Card padded={false}>
              <KeyValueList items={t.keyValue} />
            </Card>
          </Specimen>
        </Narrow>
      </Section>

      <Section title={s.sections.queue}>
        <Narrow>
          <QueueSample />
        </Narrow>
      </Section>
    </>
  );
}
