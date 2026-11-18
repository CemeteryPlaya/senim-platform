import "server-only";
import { readdir, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "@/platform/db";
import { env } from "@/platform/env";

/**
 * Чистка папки локального хранилища стенда от файлов без записи StoredFile: пересев стенда (TRUNCATE) и прежние прогоны
 * тестов оставляли PDF, сканы и фото прежних записей — десятки гигабайт. Вызывается после reseedStand (prisma/seed.ts) и
 * командой `npm run storage:prune`. Папка должна принадлежать одной базе — той, что в DATABASE_URL: файлы другой базы в
 * той же папке для неё сироты.
 */

/**
 * Файл моложе часа не удаляется, даже без записи: загрузка лежит в uploads/ без записи, пока её не подтвердят (токен
 * загрузки живёт час — TOKEN_TTL_MS в upload.ts), а saveFile пишет байты до записи в своей транзакции.
 */
export const PRUNE_GRACE_MS = 60 * 60 * 1000;

export type LocalPrunePlan = "prune" | "refuse-prod" | "refuse-no-app-env" | "skip-not-local";

/**
 * Можно ли чистить: при APP_ENV=prod — никогда (там файлы людей); APP_ENV не задан — отказ, как у пересева (забытая
 * переменная ничего не стирает); новые файлы не в local — чистить нечего. Значения переменных — как есть, до env():
 * при prod отказ не зависит от остальных переменных. STORAGE_PROVIDER не задан — local, как в env.ts.
 */
export function localPrunePlan({ appEnv, storageProvider }: { appEnv: string | undefined; storageProvider: string | undefined }): LocalPrunePlan {
  if (appEnv === "prod") return "refuse-prod";
  if (appEnv !== "dev" && appEnv !== "staging") return "refuse-no-app-env";
  return (storageProvider || "local") === "local" ? "prune" : "skip-not-local";
}

/** Пустая папка удалена; сервер успел положить в неё файл — остаётся (false). */
async function removeEmptyDir(full: string): Promise<boolean> {
  try {
    await rmdir(full);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOTEMPTY") return false;
    throw e;
  }
}

export type PruneResult ={ removed: number; removedBytes: number; kept: number };

/** Удаляет из `root` файлы, ключей которых нет в `referenced` и которые старше PRUNE_GRACE_MS; затем пустые папки (не корень). */
export async function pruneLocalFiles(input: { root: string; referenced: ReadonlySet<string>; now?: number; graceMs?: number }): Promise<PruneResult> {
  const before = (input.now ?? Date.now()) - (input.graceMs ?? PRUNE_GRACE_MS);
  const result: PruneResult = { removed: 0, removedBytes: 0, kept: 0 };

  async function walk(dir: string, prefix: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw e;
    }
    let empty = true;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!(await walk(full, key)) || !(await removeEmptyDir(full))) empty = false;
        continue;
      }
      const info = await stat(full);
      if (input.referenced.has(key) || info.mtimeMs > before) {
        result.kept++;
        empty = false;
        continue;
      }
      await rm(full, { force: true });
      result.removed++;
      result.removedBytes += info.size;
    }
    return empty;
  }

  await walk(path.resolve(input.root), "");
  return result;
}

/**
 * Чистка папки STORAGE_LOCAL_DIR по записям StoredFile базы DATABASE_URL (storageKey и previewKey). При отказе или пропуске
 * ни файлы, ни база не читаются.
 */
export async function pruneLocalStorage(
  opts: { now?: number } = {},
): Promise<{ plan: "prune"; root: string; result: PruneResult } | { plan: Exclude<LocalPrunePlan, "prune"> }> {
  const plan = localPrunePlan({ appEnv: process.env.APP_ENV, storageProvider: process.env.STORAGE_PROVIDER });
  if (plan !== "prune") return { plan };
  const root = path.resolve(env().STORAGE_LOCAL_DIR);
  const files = await db.storedFile.findMany({ select: { storageKey: true, previewKey: true } });
  const referenced = new Set(files.flatMap((f) => (f.previewKey ? [f.storageKey, f.previewKey] : [f.storageKey])));
  return { plan, root, result: await pruneLocalFiles({ root, referenced, now: opts.now }) };
}
