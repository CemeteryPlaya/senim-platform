import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import { encodeKeyPath } from "../signing";
import type { StorageProvider } from "../storage";
import { readOrNull, resolveInside } from "./local";

/**
 * Только чтение из public/: демо-файлы сида (StoredFile.provider = "static",
 * ключ — путь внутри public/, например demo/portfolio/kitchen-sage.svg).
 * Адрес — обычный статический путь, его отдаёт Next.js (и CDN на Vercel).
 * get() читает с диска: на Vercel public/ нет в файловой системе функции, поэтому
 * экранам нужен только downloadUrl, а get — для локальной генерации документов.
 */
export function createStaticStorage(publicDir: string): StorageProvider {
  return {
    name: "static",
    async put() {
      return fail.forbidden(ru.files.errors.readOnly);
    },
    async get(key) {
      return readOrNull(resolveInside(publicDir, key));
    },
    async delete() {
      return fail.forbidden(ru.files.errors.readOnly);
    },
    async downloadUrl(key) {
      return `/${encodeKeyPath(key)}`;
    },
  };
}
