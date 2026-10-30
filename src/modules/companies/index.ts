import "server-only";
import type { MeasurementTerms, Segment } from "@/generated/prisma/enums";
import type { Tx } from "@/platform/db";

/**
 * Публичный API companies. Контракты (типы и сигнатуры) зафиксированы в фазе A,
 * реализацию companies-engineer экспортирует отсюда под теми же именами.
 * Анонимность: заказчику исполнитель доступен только как PublicExecutorView.
 */
export type PublicExecutorView = {
  id: string; // ExecutorProfile.id — для ссылок и форм; личность не раскрывает
  publicNumber: number;
  label: string; // «Исполнитель №17»
  segment: Segment | null;
  ratingAvg: number;
  reviewsCount: number;
  completedDeals: number;
  yearsExperience: number;
  measurementTerms: MeasurementTerms;
  measurementFee: number | null;
  specializations: { slug: string; name: string }[];
};

/** Публичное представление исполнителя без наименования, ФИО, телефона и ИИН/БИН. */
export type GetPublicExecutorView = (executorId: string) => Promise<PublicExecutorView>;

/** deal-core → companies: пересчитать рейтинг после отзыва (в той же транзакции). */
export type RecalculateRating = (tx: Tx, executorId: string) => Promise<void>;

export const jobHandlers = {} as const;
