import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/platform/env";
import type { StorageProvider } from "../storage";

function resolveKey(key: string) {
  const root = path.resolve(env().STORAGE_LOCAL_DIR);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Недопустимый ключ файла");
  return full;
}

/** Папка на диске. Ссылки на скачивание подписывает files-модуль (фаза B). */
export const localStorageProvider: StorageProvider = {
  name: "local",
  async put(key, body) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  },
  async get(key) {
    return new Uint8Array(await readFile(resolveKey(key)));
  },
  async delete(key) {
    await rm(resolveKey(key), { force: true });
  },
  async downloadUrl(key) {
    return `/api/files/${encodeURIComponent(key)}`;
  },
};
