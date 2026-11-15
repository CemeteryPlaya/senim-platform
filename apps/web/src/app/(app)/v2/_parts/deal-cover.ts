import "server-only";
import { getDealView } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { logger } from "@/platform/logger";
import { reportsView, type ReportInput } from "../deals/[id]/_parts/deal-card";

/** Обложка карточки-героя сделки: адрес фото (раздача файлов модуля) и подпись для диктора. */
export type DealCover = { src: string; alt: string };

/**
 * Обложка из отчётов хода работ (чистая функция): самый свежий отчёт с фото — его первое фото, подпись — как у ленты
 * «Ход работ» на карточке сделки. Отчётов с фото нет — обложки нет (ничего не подставляем).
 */
export function coverOf(reports: readonly ReportInput[]): DealCover | null {
  const report = reportsView(reports).find((r) => r.photos.length > 0);
  const photo = report?.photos[0];
  return photo ? { src: photo.src, alt: photo.alt } : null;
}

/**
 * Обложка героя на главной: читает сделку тем же `getDealView`, что и карточка сделки (права и адреса файлов — модуля).
 * Сбой чтения не роняет главную — карточка без обложки.
 */
export async function dealCover(user: CurrentUser, dealId: string): Promise<DealCover | null> {
  try {
    return coverOf((await getDealView(user, dealId)).progressReports);
  } catch (error) {
    logger.warn("home deal cover failed", { dealId, error });
    return null;
  }
}
