import "server-only";
import type { DealStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { latestReportPhoto } from "@/modules/deal-core";
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
 * Статусы, в которых у сделки могут быть отчёты хода работ (мастер пишет их с начала работ): до начала, при отмене и
 * возврате до работ отчётов нет — сделку не читаем.
 */
const WITH_REPORTS: ReadonlySet<DealStatus> = new Set(["IN_PROGRESS", "READY", "ACCEPTED", "SPLIT_PAYOUT"]);

/** Есть ли смысл читать обложку сделки в этом статусе. */
export const mayHaveReports = (status: DealStatus): boolean => WITH_REPORTS.has(status);

/**
 * Обложка героя на главной: лёгкое чтение модуля `latestReportPhoto` (один запрос — последний отчёт с фото, уменьшенная
 * копия; права — как у карточки сделки) и только в статусах с отчётами (`mayHaveReports`); иначе — без чтения. Подпись —
 * как у ленты «Ход работ» (`reportsView`). Сбой чтения не роняет главную — карточка без обложки.
 */
export async function dealCover(user: CurrentUser, deal: { id: string; status: DealStatus }): Promise<DealCover | null> {
  if (!mayHaveReports(deal.status)) return null;
  const dealId = deal.id;
  try {
    const photo = await latestReportPhoto(user, dealId);
    if (!photo) return null;
    const r = ru.app.deal.card.reports;
    return { src: photo.src, alt: r.photoAlt(photo.reportTitle.trim() || r.untitled, 1) };
  } catch (error) {
    logger.warn("home deal cover failed", { dealId, error });
    return null;
  }
}
