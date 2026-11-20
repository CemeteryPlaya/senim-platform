import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Button, Chips, HiddenField, Notice, PageTitle, Pagination, Stack, TextField, TextLink, type DataTableColumn } from "@/kit";
import { listRecords, type AdminFieldInfo, type AdminRow } from "@/modules/admin";
import { isAppError } from "@/platform/errors";
import { pageHref, requireAdmin } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { filterChips } from "../../../operator/_parts/filters";
import { TableOrCards } from "../../../operator/_parts/TableOrCards";
import { cellText, FILTER, first, recordPath, recordsQueryOf, tablePath, type SearchParams } from "../../_parts/values";

const t = ru.app.admin.data;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ model: string }>; searchParams: Promise<SearchParams> };

type Listing = Awaited<ReturnType<typeof listRecords>>;

const NUMERIC = new Set(["Int", "BigInt", "Float", "Decimal"]);
const filterable = (f: AdminFieldInfo) => (f.enumValues !== undefined && !f.type.endsWith("[]")) || f.type === "Boolean";

function filterOptions(f: AdminFieldInfo) {
  const values = f.enumValues ?? ["true", "false"];
  const label = (v: string) => (f.enumValues ? v : v === "true" ? t.yes : t.no);
  return [{ value: null, label: t.filterAll }, ...values.map((v) => ({ value: v, label: label(v) }))];
}

function columnsOf(model: string, listing: Listing): DataTableColumn<AdminRow>[] {
  const { idField } = listing;
  // Ключ — первым столбцом и ссылкой на карточку; у таблицы без ключа заголовок строки — первый столбец без ссылки.
  const ordered = idField === null ? listing.fields : [...listing.fields.filter((f) => f.name === idField), ...listing.fields.filter((f) => f.name !== idField)];
  return ordered.map((f, index) => ({
    key: f.name,
    header: f.name,
    rowHeader: index === 0,
    numeric: NUMERIC.has(f.type),
    ...(index === 0 ? { width: "mid" as const } : {}),
    cell: (row: AdminRow) => {
      const value = row[f.name];
      const text = cellText(value);
      return f.name === idField && typeof value === "string" ? <TextLink href={to(recordPath(model, value))}>{text}</TextLink> : text;
    },
  }));
}

/**
 * Таблица одной модели: поиск по видимым строкам (`q`), чипы фильтров по перечислениям и булевым (`f.<поле>`), переход
 * из карточки по связи «много» (`where` и `value`), по 50 записей на страницу, новые сверху. Всё — в адресе (работает без
 * JavaScript и ссылкой). Скрытые поля сюда не приходят: столбцы и строки — то, что отдал модуль. Неверный фильтр или
 * поиск — сообщение модуля и ссылка на всю таблицу; неизвестная таблица — 404. Компьютер — таблица, телефон — карточки.
 */
export default async function AdminTablePage({ params, searchParams }: Props) {
  const [{ model }, sp] = await Promise.all([params, searchParams]);
  const screen = tablePath(model);
  const user = await requireAdmin(pageHref(screen, sp));
  const query = recordsQueryOf(sp);
  let listing: Listing | null = null;
  let error: string | null = null;
  try {
    listing = await listRecords(user, model, query);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    if (!isAppError(e) || e.code !== "VALIDATION") throw e;
    error = e.message;
  }
  const back = { href: to("/admin/data"), label: t.title };
  if (listing === null) {
    return (
      <Stack gap="section">
        <PageTitle title={model} back={back} />
        <Notice tone="danger">{error}</Notice>
        <TextLink href={to(screen)}>{t.showAll}</TextLink>
      </Stack>
    );
  }

  const result = listing;
  const keep = Object.entries(sp).flatMap(([key, value]) => {
    const one = first(value);
    return key !== "q" && key !== "page" && one !== undefined ? [{ key, value: one }] : [];
  });
  const pageCount = Math.ceil(listing.total / listing.pageSize);
  const filters = listing.fields.filter(filterable);

  return (
    <Stack gap="section">
      <PageTitle title={model} lead={t.total(listing.total)} back={back} />
      {query.where && (
        <Notice tone="info">
          {t.relation(query.where.field, query.where.value)} <TextLink href={to(screen)}>{t.showAll}</TextLink>
        </Notice>
      )}
      <form method="get" action={to(screen)} role="search">
        <div className="flex flex-col gap-stack-group desktop:flex-row desktop:items-end">
          {keep.map((p) => (
            <HiddenField key={p.key} name={p.key} value={p.value} />
          ))}
          <div className="min-w-0 desktop:flex-1">
            <TextField label={t.search} name="q" type="search" maxLength={200} autoComplete="off" defaultValue={query.q ?? ""} />
          </div>
          <Button type="submit" variant="secondary">
            {t.searchAction}
          </Button>
        </div>
      </form>
      {filters.map((f) => (
        <Chips key={f.name} label={t.filterLabel(f.name)} caption={f.name} items={filterChips(screen, sp, `${FILTER}${f.name}`, filterOptions(f))} />
      ))}
      {listing.idField === null && <p className="text-body text-muted">{t.noKey}</p>}
      <TableOrCards
        caption={model}
        captionHidden
        rows={listing.rows}
        rowKey={(row) => (result.idField !== null ? String(row[result.idField]) : JSON.stringify(row))}
        empty={{ title: t.empty, body: t.emptyBody }}
        columns={columnsOf(model, listing)}
      />
      <Pagination page={listing.page} pageCount={pageCount} label={t.pages} hrefFor={(n) => pageHref(screen, { ...sp, page: String(n) })} />
    </Stack>
  );
}
