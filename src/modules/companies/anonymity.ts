import "server-only";
import { ru } from "@/i18n/ru";
import { db, type Prisma } from "@/platform/db";
import { fail } from "@/platform/errors";
import type { GetPublicExecutorView, PublicExecutorView } from "./types";

/**
 * Слой анонимизации: единственное место, где профиль исполнителя превращается в то, что видит заказчик.
 * Выборка перечисляет только разрешённые поля — наименование, ФИО, телефон, ИИН/БИН в неё не попадают вовсе.
 */
export const PUBLIC_EXECUTOR_SELECT = {
  id: true,
  publicNumber: true,
  segment: true,
  ratingAvg: true,
  reviewsCount: true,
  completedDeals: true,
  yearsExperience: true,
  measurementTerms: true,
  measurementFee: true,
  specializations: { select: { slug: true, name: true }, orderBy: { sortOrder: "asc" } },
} as const satisfies Prisma.ExecutorProfileSelect;

export type PublicExecutorRow = Prisma.ExecutorProfileGetPayload<{ select: typeof PUBLIC_EXECUTOR_SELECT }>;

export function toPublicView(row: PublicExecutorRow): PublicExecutorView {
  return {
    id: row.id,
    publicNumber: row.publicNumber,
    label: ru.common.executorLabel(row.publicNumber),
    segment: row.segment,
    ratingAvg: row.ratingAvg,
    reviewsCount: row.reviewsCount,
    completedDeals: row.completedDeals,
    yearsExperience: row.yearsExperience,
    measurementTerms: row.measurementTerms,
    measurementFee: row.measurementTerms === "FEE_IF_NO_DEAL" ? row.measurementFee : null,
    specializations: row.specializations.map((s) => ({ slug: s.slug, name: s.name })),
  };
}

export const publicExecutorView: GetPublicExecutorView = async (executorId) => {
  const row = await db.executorProfile.findUnique({ where: { id: executorId }, select: PUBLIC_EXECUTOR_SELECT });
  if (!row) return fail.notFound(ru.companies.errors.executorNotFound);
  return toPublicView(row);
};

/** Пакетная версия для списков (отклики, сравнение): один запрос вместо N. */
export async function publicExecutorViews(executorIds: readonly string[]): Promise<Map<string, PublicExecutorView>> {
  const ids = [...new Set(executorIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.executorProfile.findMany({ where: { id: { in: ids } }, select: PUBLIC_EXECUTOR_SELECT });
  return new Map(rows.map((row) => [row.id, toPublicView(row)]));
}
