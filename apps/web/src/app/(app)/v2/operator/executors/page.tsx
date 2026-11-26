import type { Metadata } from "next";
import { formatDate } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { ButtonLink, Card, Chips, DataTable, EmptyState, List, ListRow, PageTitle, Section, Stack, StatusChip, TextLink, type DataTableColumn } from "@/kit";
import { listExecutors, listRegistrationQueue } from "@/modules/operator";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { filterChips } from "../_parts/filters";
import { REGISTRATION_STATUSES, STATUS_TONE, statusParam } from "./_parts/view";

const q = ru.app.operatorQueues;
const t = q.executors;

export const metadata: Metadata = { title: t.metaTitle };

type Row = Awaited<ReturnType<typeof listExecutors>>[number];

const cardHref = (id: string): string => to(`/operator/executors/${encodeURIComponent(id)}`);
const nameOf = (x: Pick<Row, "publicNumber" | "legalName">): string => q.executor(x.publicNumber, x.legalName);
const segmentOf = (x: Pick<Row, "segment">): string => (x.segment ? q.segments[x.segment] : q.noSegment);

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { key: "executor", header: t.columns.executor, rowHeader: true, width: "wide", cell: (x) => <TextLink href={cardHref(x.id)}>{t.row(x.publicNumber, x.legalName)}</TextLink> },
  { key: "registration", header: t.columns.registration, cell: (x) => <StatusChip tone={STATUS_TONE[x.status]}>{q.registration[x.status]}</StatusChip> },
  { key: "segment", header: t.columns.segment, width: "narrow", cell: segmentOf },
  { key: "legal", header: t.columns.legal, width: "mid", cell: (x) => t.legalShort(q.legalForms[x.legalForm], x.binIinLast4) },
  { key: "registered", header: t.columns.registered, numeric: true, cell: (x) => formatDate(x.createdAt) },
];

/**
 * Исполнители: сверху — очередь регистраций (строки-ссылки на карточку, где решение), ниже — все исполнители таблицей с
 * фильтром статуса в адресе (`?status=`, чипы — ссылки, работают без JavaScript). «Добавить исполнителя» — вторичная
 * кнопка в заголовке: главного действия у экрана нет, решение — на карточке. Широкая таблица прокручивается внутри своей
 * области (`DataTable`).
 */
export default async function ExecutorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const user = await requireOperator(to("/operator/executors"));
  const status = statusParam(params.status);
  const [queue, all] = await Promise.all([listRegistrationQueue(user), listExecutors(user)]);
  const shown = status ? all.filter((x) => x.status === status) : all;
  const count = (s: (typeof REGISTRATION_STATUSES)[number]) => all.filter((x) => x.status === s).length;
  const chips = filterChips("/operator/executors", params, "status", [
    { value: null, label: t.chip(t.filter.all, all.length) },
    ...REGISTRATION_STATUSES.map((s) => ({ value: s, label: t.chip(t.filter[s], count(s)) })),
  ]);

  return (
    <Stack gap="section">
      <PageTitle title={t.title} />
      {/* Своей строкой, не в строке заголовка: там место круглым кнопкам, а подпись при крупном шрифте не поместилась бы. */}
      <div>
        <ButtonLink href={to("/operator/executors/new")} variant="secondary" size="sm">
          {t.add}
        </ButtonLink>
      </div>
      <Section title={t.queueTitle(queue.length)} id="queue">
        {queue.length === 0 ? (
          <EmptyState title={t.queueEmpty.title} body={t.queueEmpty.body} />
        ) : (
          <Card padded={false}>
            <List>
              {queue.map((x) => (
                <ListRow
                  key={x.id}
                  href={cardHref(x.id)}
                  label={nameOf(x)}
                  detail={`${q.legal(q.legalForms[x.legalForm], x.binIinLast4)} · ${t.registered(formatDate(x.createdAt))}`}
                />
              ))}
            </List>
          </Card>
        )}
      </Section>
      <Section title={t.allTitle} id="all">
        <Chips items={chips} label={t.filterLabel} />
        <DataTable
          caption={t.allTitle}
          captionHidden
          columns={COLUMNS}
          rows={shown}
          rowKey={(x) => x.id}
          empty={status ? t.filterEmpty : t.noneYet}
        />
      </Section>
    </Stack>
  );
}
