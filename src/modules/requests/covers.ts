import { roomPhotos } from "./adapters";

/** Для include заявки: первое фото помещения — обложка карточки в списках. */
export const coverPhoto = {
  where: { purpose: "REQUEST_ROOM" },
  orderBy: { sortOrder: "asc" },
  take: 1,
  select: { id: true, provider: true, storageKey: true },
} as const;

type CoverFile = { id: string; provider: string; storageKey: string };

/** Ссылки на обложки списка заявок: функция «заявка → обложка или null». */
export async function coversOf(rows: readonly { photos: readonly CoverFile[] }[]) {
  const urls = await roomPhotos(rows.flatMap((r) => r.photos.slice(0, 1)));
  const byId = new Map(urls.map((c) => [c.id, c]));
  return (r: { photos: readonly CoverFile[] }) => (r.photos[0] ? (byId.get(r.photos[0].id) ?? null) : null);
}
