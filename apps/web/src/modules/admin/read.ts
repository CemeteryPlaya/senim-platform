// Чтение админки: список моделей, записи таблицы (поиск, фильтры, переход по связи, страницы) и карточка записи.
// Из базы выбираются только видимые поля (meta.ts); поиск, фильтры и переход — тоже только по видимым полям, так что
// значение скрытого поля (хеш, последние 4 символа) не находится и не сравнивается. Ошибки не повторяют ввод. Типы TS
// вызывающего в рантайме не проверяются: каждое значение входа сверяется с typeof, объект на месте строки — VALIDATION.
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { assertAdmin } from "./access";
import { delegateOf, type ModelDelegate } from "./delegate";
import { listSelect, modelMeta, navigationOf, recordSelect, relationsOf, scalarFields } from "./meta";
import { fieldAccess, modelReadonly } from "./rules";
import { ADMIN_MODELS, ENUMS } from "./schema.gen";
import type { AdminField, AdminModel } from "./schema-parse";
import { KEY_MAX, serializeRow, type AdminRow } from "./values";

const t = ru.app.admin.data.errors;

export const PAGE_SIZE = 50;
/** Пределы ввода из адреса страницы: длиннее — отказ (поиск, переход) или «не найдено» (ключ карточки). */
const SEARCH_MAX = 200;

export type RecordsQuery = {
  q?: string;
  /** `поле → значение`: только видимые перечисления и булевы поля (`"true"`/`"false"`). */
  filters?: Readonly<Record<string, string>>;
  /** Переход из связи «много» карточки: поле — `AdminRelation.field`, значение — ключ записи карточки. */
  where?: { field: string; value: string };
  page?: number;
};

export type AdminRelation =
  | { name: string; model: string; kind: "one"; targetId: string | null }
  | { name: string; model: string; kind: "many"; count: number; field: string };

export type AdminFieldInfo = {
  name: string;
  /** Тип схемы; список — с `[]` (`Role[]`). */
  type: string;
  access: "readonly" | "editable";
  enumValues?: readonly string[];
  required: boolean;
};

type Where = Record<string, unknown>;

function tableOf(model: string): { meta: AdminModel; delegate: ModelDelegate } {
  const meta = modelMeta(model);
  const delegate = meta ? delegateOf(db, meta.name) : null;
  if (!meta || !delegate) return fail.notFound();
  return { meta, delegate };
}

const enumValuesOf = (type: string): readonly string[] => (Object.hasOwn(ENUMS, type) ? ENUMS[type] : []);

/** Поиск `contains` без учёта регистра по видимым строковым полям; таких полей нет — ничего не находится. */
function searchCondition(model: string, raw: unknown): Where | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string") return fail.validation(ru.common.errors.invalid);
  const q = raw.trim();
  if (!q) return null;
  if (q.length > SEARCH_MAX) return fail.validation(t.searchTooLong);
  const strings = scalarFields(model).filter((f) => f.kind === "scalar" && f.type === "String" && !f.list);
  return { OR: strings.map((f) => ({ [f.name]: { contains: q, mode: "insensitive" } })) };
}

/**
 * Фильтр — только видимое перечисление (значение из схемы) или булево поле. Скрытое, неизвестное, иное поле и неверное
 * значение — один и тот же отказ VALIDATION: ответ не различает «поле есть, но скрыто» и «поля нет».
 */
function filterCondition(model: string, field: string, value: unknown): Where {
  if (typeof value !== "string") return fail.validation(t.filter);
  const f = scalarFields(model).find((x) => x.name === field);
  if (f && !f.list && f.kind === "enum" && enumValuesOf(f.type).includes(value)) return { [f.name]: value };
  if (f && !f.list && f.kind === "scalar" && f.type === "Boolean" && (value === "true" || value === "false")) return { [f.name]: value === "true" };
  return fail.validation(t.filter);
}

function navigationCondition(model: string, where: unknown): Where {
  if (typeof where !== "object" || where === null) return fail.validation(t.relation);
  const { field, value }: { field?: unknown; value?: unknown } = where;
  if (typeof field !== "string" || typeof value !== "string") return fail.validation(t.relation);
  const nav = navigationOf(model, field);
  if (!nav || !value || value.length > KEY_MAX) return fail.validation(t.relation);
  return nav.kind === "fk" ? { [field]: value } : { [field]: { some: { [nav.idField]: value } } };
}

function recordsWhere(model: string, query: RecordsQuery): Where {
  const and: Where[] = [];
  const search = searchCondition(model, query.q);
  if (search) and.push(search);
  const filters: unknown = query.filters ?? {};
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) return fail.validation(t.filter);
  for (const [field, value] of Object.entries(filters)) and.push(filterCondition(model, field, value));
  if (query.where !== undefined) and.push(navigationCondition(model, query.where));
  return and.length > 0 ? { AND: and } : {};
}

/** Новые сверху (`createdAt desc`), при равенстве — по ключу; без даты — по ключу; без ключа — по внешним ключам. */
function orderOf(meta: AdminModel, visible: readonly AdminField[]): Record<string, "asc" | "desc">[] {
  const has = (name: string) => visible.some((f) => f.name === name);
  const byId = meta.idField !== null && has(meta.idField) ? [{ [meta.idField]: "asc" as const }] : [];
  if (visible.some((f) => f.name === "createdAt" && f.type === "DateTime")) return [{ createdAt: "desc" }, ...byId];
  if (byId.length > 0) return byId;
  const fks = [...new Set(meta.fields.flatMap((f) => f.relationFields))].filter(has);
  return fks.map((name) => ({ [name]: "asc" as const }));
}

function pageOf(raw: number | undefined): number {
  return raw !== undefined && Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
}

export async function listModels(user: CurrentUser): Promise<{ name: string; count: number; readonly: boolean }[]> {
  assertAdmin(user);
  return Promise.all(
    ADMIN_MODELS.map(async (m) => ({ name: m.name, count: await tableOf(m.name).delegate.count(), readonly: modelReadonly(m.name) })),
  );
}

export async function listRecords(
  user: CurrentUser,
  model: string,
  query: RecordsQuery,
): Promise<{
  rows: AdminRow[];
  total: number;
  page: number;
  pageSize: typeof PAGE_SIZE;
  columns: readonly string[];
  /** Столбцы с типом и доступом — экран строит по ним фильтры (перечисления, булевы). */
  fields: readonly AdminFieldInfo[];
  /** Ключ записи для ссылки на карточку; null — у таблицы нет единственного видимого ключа (карточки нет). */
  idField: string | null;
}> {
  assertAdmin(user);
  const { meta, delegate } = tableOf(model);
  const where = recordsWhere(meta.name, query);
  const columns = scalarFields(meta.name);
  const page = pageOf(query.page);
  const [total, records] = await Promise.all([
    delegate.count({ where }),
    delegate.findMany({ select: listSelect(meta.name), where, orderBy: orderOf(meta, columns), skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  return {
    rows: records.map((r) => serializeRow(columns, r)),
    total,
    page,
    pageSize: PAGE_SIZE,
    columns: columns.map((f) => f.name),
    fields: columns.map((f) => describeField(meta.name, f)),
    idField: meta.idField !== null && columns.some((f) => f.name === meta.idField) ? meta.idField : null,
  };
}

function describeField(model: string, f: AdminField): AdminFieldInfo {
  return {
    name: f.name,
    type: f.list ? `${f.type}[]` : f.type,
    access: fieldAccess(model, f.name) === "editable" ? "editable" : "readonly",
    ...(f.kind === "enum" ? { enumValues: enumValuesOf(f.type) } : {}),
    required: f.required,
  };
}

function targetIdOf(value: unknown, idField: string | null): string | null {
  if (idField === null || typeof value !== "object" || value === null) return null;
  const id: unknown = (value as Record<string, unknown>)[idField];
  return typeof id === "string" ? id : null;
}

function countOf(counts: unknown, relation: string): number {
  if (typeof counts !== "object" || counts === null) return 0;
  const n: unknown = (counts as Record<string, unknown>)[relation];
  return typeof n === "number" ? n : 0;
}

export async function getRecord(
  user: CurrentUser,
  model: string,
  id: string,
): Promise<{ row: AdminRow; fields: readonly AdminFieldInfo[]; relations: readonly AdminRelation[] }> {
  assertAdmin(user);
  const { meta, delegate } = tableOf(model);
  // Ключ — только строка: объект ({ not: "" }) стал бы условием Prisma.
  if (typeof id !== "string") return fail.validation(ru.common.errors.invalid);
  if (meta.idField === null || fieldAccess(meta.name, meta.idField) === "hidden" || !id || id.length > KEY_MAX) return fail.notFound();
  const record = await delegate.findUnique({ where: { [meta.idField]: id }, select: recordSelect(meta.name) });
  if (!record) return fail.notFound();
  const scalars = scalarFields(meta.name);
  return {
    row: serializeRow(scalars, record),
    fields: scalars.map((f) => describeField(meta.name, f)),
    relations: relationsOf(meta.name).map((r): AdminRelation =>
      r.kind === "one"
        ? { name: r.name, model: r.model, kind: "one", targetId: targetIdOf(record[r.name], r.idField) }
        : { name: r.name, model: r.model, kind: "many", count: countOf(record._count, r.name), field: r.field },
    ),
  };
}
