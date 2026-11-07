import "server-only";
import { ru } from "@/i18n/ru";
import { db, type Db, type Prisma } from "@/platform/db";
import { fail } from "@/platform/errors";
import { executorDisplay, type ExecutorDisplay, type ExecutorIdentityMode } from "./display";
import { getExecutorIdentityMode } from "./identity-mode";
import type { GetPublicExecutorView, PublicExecutorView } from "./types";

/**
 * Слой анонимизации: единственное место, где профиль исполнителя превращается в то, что видит заказчик.
 * Наименование и адрес выбираются, но наружу выходят только через executorDisplay (режим №6, ADR-006):
 * в HIDDEN — «Исполнитель №N», город и район. Телефон и ИИН/БИН в выборку не попадают вовсе.
 */
export const EXECUTOR_DISPLAY_SELECT = {
  publicNumber: true,
  legalName: true,
  city: true,
  district: true,
  streetAddress: true,
} as const satisfies Prisma.ExecutorProfileSelect;

export const PUBLIC_EXECUTOR_SELECT = {
  id: true,
  ...EXECUTOR_DISPLAY_SELECT,
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

export function toPublicView(row: PublicExecutorRow, mode: ExecutorIdentityMode): PublicExecutorView {
  const shown = executorDisplay(row, mode);
  return {
    id: row.id,
    publicNumber: row.publicNumber,
    label: shown.label,
    labelGen: shown.labelGen,
    labelDat: shown.labelDat,
    address: shown.address,
    nameShown: shown.nameShown,
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
  const [row, mode] = await Promise.all([
    db.executorProfile.findUnique({ where: { id: executorId }, select: PUBLIC_EXECUTOR_SELECT }),
    getExecutorIdentityMode(),
  ]);
  if (!row) return fail.notFound(ru.companies.errors.executorNotFound);
  return toPublicView(row, mode);
};

/** Пакетная версия для списков (отклики, сравнение): один запрос вместо N. */
export async function publicExecutorViews(executorIds: readonly string[]): Promise<Map<string, PublicExecutorView>> {
  const ids = [...new Set(executorIds)];
  if (ids.length === 0) return new Map();
  const [rows, mode] = await Promise.all([
    db.executorProfile.findMany({ where: { id: { in: ids } }, select: PUBLIC_EXECUTOR_SELECT }),
    getExecutorIdentityMode(),
  ]);
  return new Map(rows.map((row) => [row.id, toPublicView(row, mode)]));
}

/**
 * Подпись и адрес исполнителя для экранов и уведомлений других модулей (сделка, заявка, чат):
 * то же решение, что и в publicExecutorView. client — транзакция вызывающего или db.
 */
export async function executorDisplays(client: Db, executorIds: readonly string[]): Promise<Map<string, ExecutorDisplay>> {
  const ids = [...new Set(executorIds)];
  if (ids.length === 0) return new Map();
  const [rows, mode] = await Promise.all([
    client.executorProfile.findMany({ where: { id: { in: ids } }, select: { id: true, ...EXECUTOR_DISPLAY_SELECT } }),
    getExecutorIdentityMode(client),
  ]);
  return new Map(rows.map((row) => [row.id, executorDisplay(row, mode)]));
}

export async function executorDisplayOf(client: Db, executorId: string): Promise<ExecutorDisplay> {
  const found = (await executorDisplays(client, [executorId])).get(executorId);
  return found ?? fail.notFound(ru.companies.errors.executorNotFound);
}
