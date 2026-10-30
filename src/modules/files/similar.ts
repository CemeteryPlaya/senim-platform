import type { FilePurpose } from "@/generated/prisma/enums";
import { db, Prisma } from "@/platform/db";
import { fail } from "@/platform/errors";

export type SimilarFile = {
  id: string;
  distance: number;
  purpose: FilePurpose;
  uploadedById: string | null;
  portfolioItemId: string | null;
};

const PHASH = /^[0-9a-f]{16}$/;

/**
 * Повторы фото по dHash: расстояние Хэмминга считает Postgres (bit_count от XOR 64-битных строк).
 * Применение — чужие фото в портфолио: ищем по хэшу нового фото, исключив загрузившего.
 * maxDistance 6 из 64 — пережатие и уменьшение того же снимка; разные снимки дают > 16.
 */
export async function findSimilar(
  phash: string,
  maxDistance = 6,
  opts: { excludeUploadedById?: string; purpose?: FilePurpose; limit?: number } = {},
): Promise<SimilarFile[]> {
  if (!PHASH.test(phash)) return fail.validation("Некорректный перцептивный хэш");
  const distance = Prisma.sql`bit_count(('x' || "phash")::bit(64) # ('x' || ${phash})::bit(64))`;
  const filters = [
    Prisma.sql`"phash" IS NOT NULL`,
    Prisma.sql`${distance} <= ${Math.max(0, Math.min(64, Math.floor(maxDistance)))}`,
    opts.excludeUploadedById ? Prisma.sql`"uploadedById" IS DISTINCT FROM ${opts.excludeUploadedById}` : Prisma.empty,
    opts.purpose ? Prisma.sql`"purpose" = ${opts.purpose}::"FilePurpose"` : Prisma.empty,
  ].filter((f) => f !== Prisma.empty);
  const rows = await db.$queryRaw<(Omit<SimilarFile, "distance"> & { distance: bigint })[]>`
    SELECT "id", "purpose", "uploadedById", "portfolioItemId", ${distance} AS "distance"
    FROM "StoredFile"
    WHERE ${Prisma.join(filters, " AND ")}
    ORDER BY "distance", "createdAt"
    LIMIT ${Math.min(opts.limit ?? 20, 100)}`;
  return rows.map((r) => ({ ...r, distance: Number(r.distance) }));
}
