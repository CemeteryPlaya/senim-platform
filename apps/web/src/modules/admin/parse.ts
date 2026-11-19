// Разбор значения из формы правки по типу поля схемы. Типы — ровно те, что реестр открывает для правки (rules.ts:
// EDITABLE_SCALARS и перечисления-не-статусы); прочие — FORBIDDEN, даже если вызывающий обошёл проверку доступа.
import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import { ENUMS } from "./schema.gen";
import type { AdminField } from "./schema-parse";

const t = ru.app.admin.record.errors;

export type ParsedValue = string | number | boolean | Date | null;
export type ParseResult = { ok: true; value: ParsedValue } | { ok: false; error: string };

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
/** ISO 8601 с часовым поясом: без пояса время неоднозначно (Астана UTC+5 или UTC). */
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** Дата и время — настоящие: `new Date` переносит 31.02 на 03.03 и 24:00 на следующий день, здесь это ошибка. */
function parseDateTime(raw: string): Date | null {
  const m = ISO_DATE_TIME.exec(raw);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const ok = (value: ParsedValue): ParseResult => ({ ok: true, value });
const bad = (error: string): ParseResult => ({ ok: false, error });

/**
 * `side` — какое значение разбирается: `to` (новое) или `from` (прежнее, для условного обновления). Пустое значение
 * необязательного поля — null (Ruling: форма не различает «пусто» и «нет значения»). У обязательной строки новое пустое
 * значение — ошибка, а прежнее пустое допустимо: в базе бывает `""` по умолчанию (Request.wishes, PortfolioItem.place).
 */
export function parseFieldValue(field: AdminField, raw: string | null, side: "from" | "to"): ParseResult {
  if (field.list || (field.kind !== "scalar" && field.kind !== "enum")) return fail.forbidden();
  if (field.kind === "scalar" && !["String", "Int", "Boolean", "DateTime"].includes(field.type)) return fail.forbidden();
  if (raw === null || raw === "") {
    if (!field.required) return ok(null);
    return side === "from" && raw === "" && field.type === "String" ? ok("") : bad(t.required);
  }
  if (field.kind === "enum") return Object.hasOwn(ENUMS, field.type) && ENUMS[field.type].includes(raw) ? ok(raw) : bad(t.enumValue);
  switch (field.type) {
    case "String":
      return ok(raw);
    case "Int": {
      if (!/^-?\d{1,10}$/.test(raw)) return bad(t.int);
      const n = Number(raw);
      return n >= INT32_MIN && n <= INT32_MAX ? ok(n) : bad(t.int);
    }
    case "Boolean":
      return raw === "true" ? ok(true) : raw === "false" ? ok(false) : bad(t.boolean);
    default: {
      const date = parseDateTime(raw);
      return date ? ok(date) : bad(t.dateTime);
    }
  }
}

export function sameValue(a: ParsedValue, b: ParsedValue): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}
