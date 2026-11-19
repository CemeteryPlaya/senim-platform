// Правка записи админкой. Порядок (спека, решение владельца 5): роль и второй фактор → модель и каждое поле по реестру
// (запрещённое — FORBIDDEN, ничего не пишется) → разбор значений по типу → в одной транзакции запись аудита со старым
// и новым значением, затем условный updateMany по ключу и прежним значениям. Ноль строк — CONFLICT, и аудит
// откатывается вместе с транзакцией: изменения без аудита и аудита без изменения не бывает.
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import type { CurrentUser } from "@/modules/identity";
import { db, Prisma, transaction } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { assertAdmin } from "./access";
import { delegateOf } from "./delegate";
import { modelMeta } from "./meta";
import { parseFieldValue, sameValue, type ParsedValue } from "./parse";
import { fieldAccess, modelReadonly } from "./rules";
import type { AdminField } from "./schema-parse";
import { serializeValue } from "./values";

const t = ru.app.admin.record;
const ID_MAX = 200;

export type FieldChange = { field: string; from: string | null; to: string | null };
export type UpdateRecordInput = { model: string; id: string; changes: readonly FieldChange[] };

type Parsed = { field: AdminField; from: ParsedValue; to: ParsedValue };

/**
 * Условие на прежнее значение. У необязательной строки «нет значения» совпадает и с null, и с `""` в базе: форма
 * показывает оба пустым полем, и правка такого поля не должна навсегда упираться в CONFLICT.
 */
function fromCondition({ field, from }: Parsed): Record<string, unknown> {
  if (from === null && !field.required && field.type === "String") return { OR: [{ [field.name]: null }, { [field.name]: "" }] };
  return { [field.name]: from };
}

function auditValues(changes: readonly Parsed[], side: "from" | "to"): Prisma.InputJsonObject {
  return Object.fromEntries(changes.map((c) => [c.field.name, serializeValue(c.field, c[side])]));
}

export async function updateRecord(user: CurrentUser, input: UpdateRecordInput): Promise<{ changed: number }> {
  assertAdmin(user);
  const meta = modelMeta(input.model);
  if (!meta || !delegateOf(db, meta.name) || meta.idField === null || modelReadonly(meta.name)) return fail.forbidden();
  const idField = meta.idField;

  // Сначала права на каждое поле: одно запрещённое — отказ всей правки, текст без имени и значения поля.
  const fields = input.changes.map((c) => {
    const field = meta.fields.find((f) => f.name === c.field);
    if (!field || fieldAccess(meta.name, c.field) !== "editable") return fail.forbidden();
    return field;
  });
  if (new Set(fields.map((f) => f.name)).size !== fields.length) {
    const duplicate = fields.find((f, i) => fields.findIndex((g) => g.name === f.name) !== i)?.name ?? "";
    return fail.validation(ru.common.errors.invalid, { fieldErrors: { [duplicate]: [t.errors.duplicate] } });
  }
  if (!input.id || input.id.length > ID_MAX) return fail.validation(ru.common.errors.invalid);

  const fieldErrors: Record<string, string[]> = {};
  const parsed: Parsed[] = [];
  input.changes.forEach((c, i) => {
    const field = fields[i];
    const from = parseFieldValue(field, c.from, "from");
    const to = parseFieldValue(field, c.to, "to");
    const error = !to.ok ? to.error : !from.ok ? from.error : null;
    if (error !== null) fieldErrors[field.name] = [error];
    else if (from.ok && to.ok) parsed.push({ field, from: from.value, to: to.value });
  });
  if (Object.keys(fieldErrors).length > 0) return fail.validation(ru.common.errors.invalid, { fieldErrors });

  const changes = parsed.filter((c) => !sameValue(c.from, c.to));
  if (changes.length === 0) return { changed: 0 };

  await transaction(async (tx) => {
    await recordAudit(tx, {
      actor: { kind: "user", id: user.id, role: "ADMIN" },
      action: "admin.record.updated",
      entity: { type: meta.name, id: input.id },
      before: auditValues(changes, "from"),
      after: auditValues(changes, "to"),
    });
    const delegate = delegateOf(tx, meta.name);
    if (!delegate) return fail.forbidden();
    const result = await delegate.updateMany({
      where: { AND: [{ [idField]: input.id }, ...changes.map(fromCondition)] },
      data: Object.fromEntries(changes.map((c) => [c.field.name, c.to])),
    });
    expectOneUpdated(result, t.conflict);
  });
  return { changed: changes.length };
}
