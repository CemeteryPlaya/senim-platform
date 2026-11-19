import "server-only";
import type { FileView } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { db, transaction } from "@/platform/db";
import { fail } from "@/platform/errors";
import { auditByUser } from "./access";
import { DESIGN_FILE_SELECT, designViews } from "./adapters";

/**
 * Свой дизайн-проект заявки глазами тех, кому видны и скрытые файлы: покупателя-загрузчика и оператора. Скрытие —
 * страховка от контактов в файле (решение спеки 2026-11-19): файл не удаляется, мастерам и сделке его модули не отдают
 * (фильтр `hiddenAt: null` в их запросах), оператор может вернуть.
 */

export type DesignFileView = FileView & { hidden: boolean };

/** Все файлы проекта по порядку; скрытые оператором — с пометкой `hidden`. Права проверяет вызывающий. */
export async function designWithHidden(requestId: string): Promise<DesignFileView[]> {
  const files = await db.storedFile.findMany({
    where: { requestId, purpose: "REQUEST_DESIGN" },
    orderBy: { sortOrder: "asc" },
    select: { ...DESIGN_FILE_SELECT, hiddenAt: true },
  });
  const hidden = new Set(files.filter((f) => f.hiddenAt !== null).map((f) => f.id));
  return (await designViews(files)).map((view) => ({ ...view, hidden: hidden.has(view.id) }));
}

function requireOperator(user: CurrentUser): void {
  if (user.role !== "OPERATOR") fail.forbidden();
}

/** Файлы дизайн-проекта заявки по номеру — для оператора; заявки нет — «не найдено». */
export async function getRequestDesignFiles(user: CurrentUser, requestNumber: number): Promise<{ requestId: string; number: number; files: DesignFileView[] }> {
  requireOperator(user);
  const r = await db.request.findUnique({ where: { number: requestNumber }, select: { id: true, number: true } });
  if (!r) return fail.notFound();
  return { requestId: r.id, number: r.number, files: await designWithHidden(r.id) };
}

/**
 * Оператор скрывает (`hidden: true`) или возвращает файл дизайн-проекта. Условный `updateMany` по `hiddenAt`: повтор и
 * одновременное нажатие дают один эффект и одну запись аудита (повтор — `{ changed: false }` без аудита). Аудит — в той
 * же транзакции. Не файл проекта заявки (фото помещения, чужое назначение, нет такого) — «не найдено».
 */
export async function setRequestFileHidden(user: CurrentUser, input: { fileId: string; hidden: boolean }): Promise<{ changed: boolean }> {
  requireOperator(user);
  const { fileId, hidden } = input;
  return transaction(async (tx) => {
    const file = await tx.storedFile.findFirst({ where: { id: fileId, purpose: "REQUEST_DESIGN" }, select: { requestId: true } });
    if (!file?.requestId) return fail.notFound();
    const { count } = await tx.storedFile.updateMany({
      where: { id: fileId, purpose: "REQUEST_DESIGN", hiddenAt: hidden ? null : { not: null } },
      data: hidden ? { hiddenAt: new Date(), hiddenById: user.id } : { hiddenAt: null, hiddenById: null },
    });
    if (count === 0) return { changed: false };
    await auditByUser(tx, user, file.requestId, {
      action: hidden ? "request.design_file_hidden" : "request.design_file_restored",
      entity: { type: "request", id: file.requestId },
      meta: { fileId },
    });
    return { changed: true };
  });
}
