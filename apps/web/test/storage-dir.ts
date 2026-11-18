import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Хранилище файлов тестов — во временной папке прогона, не в `apps/web/storage` (там файлы dev и стенда; тестовая база после
 * прогона пустая, и всё, что тесты туда писали, оставалось сиротами — десятки гигабайт). Папку прогона создаёт глобальная
 * настройка integration (test/global-setup.ts) и удаляет в teardown; путь передаётся тестам этой переменной.
 */
export const TEST_STORAGE_ROOT_ENV = "SENIM_TEST_STORAGE_ROOT";

const RUN_PREFIX = "senim-test-storage-";

/** Папка прогона, оставшаяся от прерванного прогона (teardown не дошёл), старше суток — удаляется следующим прогоном. */
export const STALE_RUN_MS = 24 * 60 * 60 * 1000;

/** Новая папка прогона: `<tmp>/senim-test-storage-<уникально>`. */
export function createRunStorageRoot(base: string = tmpdir()): Promise<string> {
  return mkdtemp(path.join(base, RUN_PREFIX));
}

/**
 * Удаляет папки прерванных прогонов старше `maxAgeMs`; свежие не трогает — их может держать параллельный прогон.
 * Возвращает удалённые пути.
 */
export async function removeStaleRunRoots(base: string = tmpdir(), now: number = Date.now(), maxAgeMs: number = STALE_RUN_MS): Promise<string[]> {
  const removed: string[] = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(RUN_PREFIX)) continue;
    const full = path.join(base, entry.name);
    const { mtimeMs } = await stat(full);
    if (now - mtimeMs < maxAgeMs) continue;
    await rm(full, { recursive: true, force: true });
    removed.push(full);
  }
  return removed;
}

/** Временная папка теста внутри папки прогона (её удалит teardown, даже если тест не убрал за собой); вне прогона — в tmp. */
export function testTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(process.env[TEST_STORAGE_ROOT_ENV] ?? tmpdir(), prefix));
}
