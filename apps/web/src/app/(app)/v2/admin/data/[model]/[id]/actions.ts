"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { KEY_MAX, updateRecord } from "@/modules/admin";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { fail, isAppError } from "@/platform/errors";
import { to } from "../../../../../_shell/paths";
import { recordPath } from "../../../_parts/values";

const t = ru.app.admin.record;

const changeSchema = z.strictObject({
  field: z.string().min(1).max(64),
  from: z.string().max(10_000).nullable(),
  to: z.string().max(10_000).nullable(),
});

const updateRecordSchema = z.strictObject({
  model: z.string().min(1).max(64),
  id: z.string().min(1).max(KEY_MAX), // предел ключа модуля: схема и модуль не расходятся
  changes: z.array(changeSchema).min(1).max(50),
});

/**
 * Правка записи из карточки админки. Вход — строго по схеме (лишний ключ — VALIDATION), затем роль ADMIN со вторым
 * фактором — первой строкой; модель, поле и значения проверяет модуль admin (реестр правил, разбор по типу, аудит и
 * условное обновление в одной транзакции). Отказ модуля по правам — свой текст админки без имени поля; конфликт и ошибки
 * значений — тексты модуля (`ru.app.admin.record`).
 */
export const updateRecordAction = action("app.admin.updateRecord", updateRecordSchema, async (input) => {
  const user = await requireUser("ADMIN");
  let result: { changed: number };
  try {
    result = await updateRecord(user, input);
  } catch (e) {
    if (isAppError(e) && e.code === "FORBIDDEN") return fail.forbidden(t.errors.forbidden);
    throw e;
  }
  if (result.changed > 0) revalidatePath(to(recordPath(input.model, input.id)));
  return result;
});
