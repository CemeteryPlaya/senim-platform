import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Предохранитель перед стартом e2e-сервера (`next dev`, e2e/web-server.ts): файловый кэш Turbopack для dev
 * (`<distDir>/dev/cache/turbopack`) рос без предела — 15 ГБ в .next-e2e. С `experimental.turbopackGc` (next.config.ts) он
 * чистится сам; если всё же разросся больше порога — удаляется целиком, первый заход на страницы будет медленнее.
 */
export const TURBOPACK_CACHE_LIMIT_BYTES = 5 * 1024 ** 3;

/** Размер папки со всеми вложенными файлами; нет папки — 0. */
export async function dirSizeBytes(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSizeBytes(full) : (await stat(full)).size;
  }
  return total;
}

/** Удаляет `<distDir>/dev/cache/turbopack`, если он больше `limit`; возвращает, удалён ли и сколько занимал. */
export async function trimTurbopackDevCache(distDir: string, limit: number = TURBOPACK_CACHE_LIMIT_BYTES): Promise<{ removed: boolean; bytes: number }> {
  const cache = path.join(distDir, "dev", "cache", "turbopack");
  const bytes = await dirSizeBytes(cache);
  if (bytes <= limit) return { removed: false, bytes };
  await rm(cache, { recursive: true, force: true });
  return { removed: true, bytes };
}
