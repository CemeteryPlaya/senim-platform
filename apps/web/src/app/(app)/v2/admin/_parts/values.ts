// Чистые помощники экранов админки (сервер и клиентская форма): значение для показа, значение для формы правки,
// правка из полей формы и разбор адреса таблицы. Типы — из модуля admin (только типы: клиентская форма не тянет сервер).
import { ru } from "@/i18n/ru";
import type { AdminFieldInfo, AdminValue, FieldChange, RecordsQuery } from "@/modules/admin";

const t = ru.app.admin.data;

/** Параметры адреса страницы, как их отдаёт Next. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** Ячейка таблицы длиннее — обрезается (полное значение — в карточке). */
export const CELL_MAX = 120;

/** Префиксы полей формы правки: новое значение и прежнее (скрытое поле; нет поля — прежнего значения нет, null). */
export const TO = "to.";
export const FROM = "from.";
/** Фильтр таблицы в адресе: `f.<поле>=<значение>`. */
export const FILTER = "f.";

export const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** Значение для показа: пусто — «—», булево — «да»/«нет», список — через запятую; дата — как в базе (ISO, с поясом). */
export function displayValue(value: AdminValue | undefined): string {
  if (value === null || value === undefined) return t.none;
  if (typeof value === "boolean") return value ? t.yes : t.no;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value === "" ? t.none : value;
  return value.length === 0 ? t.none : value.join(", ");
}

export function cellText(value: AdminValue | undefined): string {
  const text = displayValue(value);
  return text.length > CELL_MAX ? `${text.slice(0, CELL_MAX - 1)}…` : text;
}

/** Значение записи → строка формы правки (и прежнее значение для условного обновления); нет значения — null. */
export function formValue(value: AdminValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Обязательное булево поле правится флажком (снят — `false`), необязательное — списком «да / нет / не выбрано». */
export const isCheckbox = (field: AdminFieldInfo): boolean => field.type === "Boolean" && field.required;

/** Правка из полей формы: по одной на каждое редактируемое поле; неизменённые модуль отбросит сам. */
export function changesFrom(data: FormData, fields: readonly AdminFieldInfo[]): FieldChange[] {
  const text = (key: string): string | null => {
    const value = data.get(key);
    return typeof value === "string" ? value : null;
  };
  return fields
    .filter((f) => f.access === "editable")
    .map((f) => ({
      field: f.name,
      from: text(`${FROM}${f.name}`),
      to: isCheckbox(f) ? (text(`${TO}${f.name}`) === "true" ? "true" : "false") : text(`${TO}${f.name}`),
    }));
}

/** Адрес таблицы → запрос модуля: `q`, `f.<поле>`, переход по связи `where`+`value`, `page`. Проверяет модуль. */
export function recordsQueryOf(params: SearchParams): RecordsQuery {
  const filters: Record<string, string> = {};
  for (const [key, raw] of Object.entries(params)) {
    const value = first(raw);
    if (key.startsWith(FILTER) && value !== undefined && value !== "") filters[key.slice(FILTER.length)] = value;
  }
  const q = first(params.q);
  const where = first(params.where);
  const value = first(params.value);
  const page = Number(first(params.page));
  return {
    ...(q ? { q } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(where !== undefined || value !== undefined ? { where: { field: where ?? "", value: value ?? "" } } : {}),
    ...(Number.isSafeInteger(page) && page >= 1 ? { page } : {}),
  };
}

/** Адрес таблицы и карточки (пути без префикса v2: через `to`/`pageHref`). */
export const tablePath = (model: string) => `/admin/data/${encodeURIComponent(model)}`;
export const recordPath = (model: string, id: string) => `${tablePath(model)}/${encodeURIComponent(id)}`;
