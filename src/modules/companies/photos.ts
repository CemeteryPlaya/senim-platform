import { fileUrl } from "@/modules/files";
import type { PhotoView } from "./types";

type FileRow = { id: string; provider: string; storageKey: string };

/** Адрес фото для <img>: подписанная ссылка хранилища (local/s3/vercel-blob) или путь в public/ для сида. */
export function photoSrc(file: FileRow): Promise<string> {
  return fileUrl(file);
}

export function toPhotoViews(files: readonly FileRow[], alt: (n: number) => string): Promise<PhotoView[]> {
  return Promise.all(files.map(async (f, i) => ({ id: f.id, src: await photoSrc(f), alt: alt(i + 1) })));
}

export const PHOTO_SELECT = { id: true, provider: true, storageKey: true } as const;
