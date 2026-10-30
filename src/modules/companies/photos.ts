import type { PhotoView } from "./types";

type FileRow = { id: string; provider: string; storageKey: string };

/**
 * Адрес фото для <img>.
 * INTEGRATOR: заменить на функцию модуля files (адрес по StoredFile с подписью для local/s3/vercel-blob),
 * когда она появится в @/modules/files. Сейчас показываем только демо-файлы сида (provider = "static",
 * ключ — путь внутри public/); для остальных провайдеров — null, экран рисует заглушку.
 */
export function photoSrc(file: FileRow): string | null {
  return file.provider === "static" ? `/${file.storageKey}` : null;
}

export function toPhotoViews(files: readonly FileRow[], alt: (n: number) => string): PhotoView[] {
  return files.map((f, i) => ({ id: f.id, src: photoSrc(f), alt: alt(i + 1) }));
}

export const PHOTO_SELECT = { id: true, provider: true, storageKey: true } as const;
