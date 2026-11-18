import "server-only";
import { lstat, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/platform/db";
import { env } from "@/platform/env";

/**
 * Чистка папки локального хранилища стенда от файлов без записи StoredFile: пересев стенда (TRUNCATE) и прежние прогоны
 * тестов оставляли PDF, сканы и фото прежних записей — десятки гигабайт. Вызывается после reseedStand (prisma/seed.ts) и
 * командой `npm run storage:prune`.
 *
 * Папка должна принадлежать одной базе — той, что в DATABASE_URL: файлы другой базы в той же папке для неё сироты. Поэтому
 * чистка идёт только по метке владельца (STORAGE_DB_MARK — имя базы в корне папки) и только при совпадении с базой. Метку
 * пишет сид стенда (prisma/seed.ts) и только в новую или пустую папку: непустая папка без метки (общая с dev, корень
 * репозитория, домашняя папка) метку не получает и не чистится никогда; storage:prune метку не создаёт.
 */

/**
 * Файл моложе часа не удаляется, даже без записи: загрузка лежит в uploads/ без записи, пока её не подтвердят (токен
 * загрузки живёт час — TOKEN_TTL_MS в upload.ts), а saveFile пишет байты до записи в своей транзакции.
 */
export const PRUNE_GRACE_MS = 60 * 60 * 1000;

export type LocalPrunePlan = "prune" | "refuse-prod" | "refuse-no-app-env" | "skip-not-local";

/** Файл метки владельца в корне STORAGE_LOCAL_DIR: имя базы, чьи записи StoredFile ссылаются на файлы этой папки. */
export const STORAGE_DB_MARK = ".senim-storage-db";

/** Имя базы из DATABASE_URL (путь без «/» и без параметров). */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** Метка папки; нет папки или метки — null. */
export async function readStorageMark(root: string): Promise<string | null> {
  try {
    return (await readFile(path.join(root, STORAGE_DB_MARK), "utf8")).trim() || null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Пишет метку `database`, только если папки нет или она пуста; метку не перезаписывает; в непустую папку без метки не пишет. */
export async function markStorageIfNew(root: string, database: string): Promise<"created" | "exists" | "not-empty"> {
  if ((await readStorageMark(root)) !== null) return "exists";
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (entries.length > 0) return "not-empty";
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, STORAGE_DB_MARK), `${database}\n`, { flag: "wx" });
  return "created";
}

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

export type PruneResult = { removed: number; removedBytes: number; kept: number };

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
      // lstat: висячая ссылка не прерывает обход; ссылка удаляется сама, не её цель.
      const info = await lstat(full);
      if (key === STORAGE_DB_MARK || input.referenced.has(key) || info.mtimeMs > before) {
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
 * Сид стенда перед заполнением: метка папки STORAGE_LOCAL_DIR именем базы DATABASE_URL, если папка новая или пустая (иначе
 * — «not-empty»: чистка этой папки дальше откажет). При тех же отказах, что у чистки (prod, без APP_ENV, не local), ничего не
 * пишется.
 */
export async function markLocalStorageIfNew(): Promise<Awaited<ReturnType<typeof markStorageIfNew>> | Exclude<LocalPrunePlan, "prune">> {
  const plan = localPrunePlan({ appEnv: process.env.APP_ENV, storageProvider: process.env.STORAGE_PROVIDER });
  if (plan !== "prune") return plan;
  const e = env();
  return markStorageIfNew(path.resolve(e.STORAGE_LOCAL_DIR), databaseName(e.DATABASE_URL));
}

export type PruneOutcome =
  | { plan: "prune"; root: string; result: PruneResult }
  | { plan: "refuse-no-mark"; root: string; database: string }
  | { plan: "refuse-foreign-db"; root: string; database: string; mark: string }
  | { plan: Exclude<LocalPrunePlan, "prune"> };

/**
 * Чистка папки STORAGE_LOCAL_DIR по записям StoredFile базы DATABASE_URL (storageKey и previewKey) — только если метка
 * папки совпадает с базой. При отказе или пропуске файлы не удаляются; при отказе по APP_ENV и провайдеру не читаются ни
 * папка, ни база.
 */
export async function pruneLocalStorage(opts: { now?: number } = {}): Promise<PruneOutcome> {
  const plan = localPrunePlan({ appEnv: process.env.APP_ENV, storageProvider: process.env.STORAGE_PROVIDER });
  if (plan !== "prune") return { plan };
  const e = env();
  const root = path.resolve(e.STORAGE_LOCAL_DIR);
  const database = databaseName(e.DATABASE_URL);
  const mark = await readStorageMark(root);
  if (mark === null) return { plan: "refuse-no-mark", root, database };
  if (mark !== database) return { plan: "refuse-foreign-db", root, database, mark };
  const files = await db.storedFile.findMany({ select: { storageKey: true, previewKey: true } });
  const referenced = new Set(files.flatMap((f) => (f.previewKey ? [f.storageKey, f.previewKey] : [f.storageKey])));
  return { plan, root, result: await pruneLocalFiles({ root, referenced, now: opts.now }) };
}

/** Текст отказа или пропуска для журнала (сид, storage:prune): что не так и что сделать. */
export function pruneRefusalHint(out: Exclude<PruneOutcome, { plan: "prune" }>): string {
  switch (out.plan) {
    case "refuse-prod":
      return "Чистка хранилища запрещена при APP_ENV=prod";
    case "refuse-no-app-env":
      return "Чистка хранилища — только при явном APP_ENV=dev или APP_ENV=staging";
    case "skip-not-local":
      return "STORAGE_PROVIDER не local — локальную папку не чистим";
    case "refuse-no-mark":
      return `В ${out.root} нет метки ${STORAGE_DB_MARK}: папка может принадлежать другой базе, чистка пропущена. Метку пишет сид стенда только в новую или пустую папку — задайте базе ${out.database} свою пустую STORAGE_LOCAL_DIR и пересейте стенд`;
    case "refuse-foreign-db":
      return `Папка ${out.root} помечена базой ${out.mark} (${STORAGE_DB_MARK}), а DATABASE_URL — база ${out.database}: чистка по чужой базе удалила бы её файлы. Проверьте DATABASE_URL и STORAGE_LOCAL_DIR`;
  }
}
