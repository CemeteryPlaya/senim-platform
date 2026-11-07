import "server-only";
import type { JobHandler } from "@/platform/jobs";
import { db } from "@/platform/db";
import { storageByName } from "./registry";
import { UNATTACHED } from "./upload";

/** Неприкреплённый файл старше суток — брошенная загрузка или проигравший повтор задачи (ai.visualize). */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

/**
 * Задача files.cleanupOrphans: удаляет записи и байты неприкреплённых файлов старше суток.
 * Запись удаляется условно (всё ещё не прикреплена) — файл, который как раз прикрепляют, не пропадёт.
 * Демо-файлы (static) живут в public/ и не трогаются.
 */
export const cleanupOrphans: JobHandler = async (_payload, ctx) => {
  const before = new Date(Date.now() - ORPHAN_AGE_MS);
  const candidates = await db.storedFile.findMany({
    where: { ...UNATTACHED, createdAt: { lt: before }, provider: { not: "static" } },
    select: { id: true, provider: true, storageKey: true },
    take: BATCH,
  });
  let removed = 0;
  for (const file of candidates) {
    const result = await db.storedFile.deleteMany({ where: { id: file.id, ...UNATTACHED } });
    if (result.count === 0) continue;
    removed++;
    await (await storageByName(file.provider)).delete(file.storageKey).catch((error: unknown) => {
      ctx.log.warn("files.cleanup.delete_failed", { fileId: file.id, error });
    });
  }
  ctx.log.info("files.cleanup.done", { removed });
};
