import "server-only";
import { listExecutorReviews, listPublicPortfolio } from "@/modules/companies";
import { fileUrl, fileViews } from "@/modules/files";

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

/** Файл дизайн-проекта из базы в объёме, нужном виду (`fileViews`). */
export const DESIGN_FILE_SELECT = { id: true, provider: true, storageKey: true, contentType: true } as const;

/**
 * Свой дизайн-проект заявки для экрана: фото или PDF с подписанными ссылками; PDF скачивается как `design-N.pdf` (исходное
 * имя файла не хранится). Права и отбор скрытых — у вызывающего: мастеру и сделке скрытые не передаются вовсе.
 */
export const designViews = (files: readonly { id: string; provider: string; storageKey: string; contentType: string }[]) =>
  fileViews(files, (n) => `design-${n}.pdf`);
