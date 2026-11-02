import { fileUrl } from "@/modules/files";
import type { Prisma } from "@/platform/db";
import type { PhotoView } from "./types";

type FileRow = { id: string; provider: string; storageKey: string };

/** Адрес фото для <img>: подписанная ссылка хранилища (local/s3/vercel-blob) или путь в public/ для сида. */
function photoSrc(file: FileRow): Promise<string> {
  return fileUrl(file);
}

export function toPhotoViews(files: readonly FileRow[], alt: (n: number) => string): Promise<PhotoView[]> {
  return Promise.all(files.map(async (f, i) => ({ id: f.id, src: await photoSrc(f), alt: alt(i + 1) })));
}

export const PHOTO_SELECT = { id: true, provider: true, storageKey: true } as const;

/** Свои фото работы (загружены в портфолио) — и фото отчёта этапа: порядок, затем время загрузки. */
export const OWN_PHOTOS = {
  select: PHOTO_SELECT,
  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
} satisfies Prisma.PortfolioItem$photosArgs;
/** Итоговые фото сделки, на которые ссылается работа (PortfolioDealPhoto): файлы этапа, не копии. */
export const DEAL_PHOTOS = {
  select: { file: { select: PHOTO_SELECT } },
  orderBy: { sortOrder: "asc" },
} satisfies Prisma.PortfolioItem$dealPhotosArgs;

/** Все фото работы по порядку: сначала итоговые фото сделки, затем загруженные. Первое — обложка. */
export function itemFiles(row: { photos: readonly FileRow[]; dealPhotos: readonly { file: FileRow }[] }): FileRow[] {
  return [...row.dealPhotos.map((p) => p.file), ...row.photos];
}
