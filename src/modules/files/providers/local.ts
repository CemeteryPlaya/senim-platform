import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDownloadUrl, type SignOpts } from "../signing";
import type { StorageProvider } from "../storage";

/** Полный путь внутри корня; ключ с «..» или абсолютный путь не выпускает за его пределы. */
export function resolveInside(root: string, key: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error("Недопустимый ключ файла");
  return full;
}

export async function readOrNull(full: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(full));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Папка на диске — только для разработки (на Vercel файловая система функции временная).
 * Ссылки на скачивание подписаны HMAC и обслуживаются маршрутом /api/files/[...key];
 * загрузка — PUT на /api/files/upload с токеном загрузки.
 */
export function createLocalStorage(root: string, sign?: () => SignOpts): StorageProvider {
  return {
    name: "local",
    async put(key, body) {
      const full = resolveInside(root, key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body);
    },
    async get(key) {
      return readOrNull(resolveInside(root, key));
    },
    async delete(key) {
      await rm(resolveInside(root, key), { force: true });
    },
    async downloadUrl(key, opts) {
      return localDownloadUrl(key, opts, sign?.());
    },
    async uploadTarget(_key, opts) {
      return {
        kind: "http",
        url: `/api/files/upload?${new URLSearchParams({ token: opts.token })}`,
        method: "PUT",
        headers: { "content-type": opts.contentType },
      };
    },
  };
}
