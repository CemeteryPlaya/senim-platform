import "server-only";
import { listExecutorReviews, listPublicPortfolio } from "@/modules/companies";
import { fileUrl } from "@/modules/files";

/**
 * Зависимости от соседних модулей, приведённые к форме экранов requests.
 * Исполнитель для заказчика — только через companies (publicExecutorView), без личных данных.
 */

export type PortfolioPreview = { id: string; title: string; style: string; photos: { src: string; alt: string }[] };

/** Опубликованные работы исполнителя: только фото, которые уже можно показать. */
export async function executorPortfolio(executorId: string, limit: number): Promise<PortfolioPreview[]> {
  const cards = await listPublicPortfolio(executorId, limit);
  return cards.map((c) => ({
    id: c.id,
    title: c.title,
    style: c.style.key,
    photos: c.photos.flatMap((p) => (p.src ? [{ src: p.src, alt: p.alt }] : [])),
  }));
}

export const executorReviews = (executorId: string) => listExecutorReviews(executorId);

/** Фото помещения заявки с адресами для <img> (подписанные ссылки модуля files). */
export async function roomPhotos(files: readonly { id: string; provider: string; storageKey: string }[]) {
  return Promise.all(files.map(async (f) => ({ id: f.id, src: await fileUrl(f) })));
}
