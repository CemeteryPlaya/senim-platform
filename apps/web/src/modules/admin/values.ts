// Значения базы → значения для экрана админки. Сериализация зависит от типа поля схемы, а не от значения: строка Json
// и строка String в рантайме неразличимы. Деньги (BigInt, тиыны) — строкой цифр: в number они теряли бы точность
// за 2^53, а RSC и JSON BigInt не передают.
import type { AdminField } from "./schema-parse";

/**
 * Предел длины ключа записи и значения перехода по связи — один для действия (zod), чтения и правки: длиннее —
 * отказ до запроса в базу. Ключи схемы — cuid и UUID (≤ 36 символов), запас — для составных и текстовых ключей.
 */
export const KEY_MAX = 200;

export type AdminValue = string | number | boolean | null | readonly string[];
export type AdminRow = Readonly<Record<string, AdminValue>>;

type FieldShape = Pick<AdminField, "kind" | "type" | "list">;

function scalarText(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return String(value);
}

export function serializeValue(field: FieldShape, value: unknown): AdminValue {
  if (value === null || value === undefined) return null;
  if (field.list) return Array.isArray(value) ? value.map(scalarText) : null;
  if (field.kind === "enum") return String(value);
  switch (field.type) {
    case "Json":
      return JSON.stringify(value);
    case "DateTime":
      return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
    case "Int":
    case "Float":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "Boolean":
      return typeof value === "boolean" ? value : null;
    case "String":
      return typeof value === "string" ? value : null;
    default:
      // BigInt — строка цифр; Decimal — его toString (точное десятичное); Bytes — base64.
      return scalarText(value);
  }
}

/** Строка для экрана: только перечисленные поля (видимые по правилам), лишние ключи записи отбрасываются. */
export function serializeRow(fields: readonly AdminField[], record: Readonly<Record<string, unknown>>): AdminRow {
  return Object.fromEntries(fields.map((f) => [f.name, serializeValue(f, Object.hasOwn(record, f.name) ? record[f.name] : null)]));
}
