import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { previewUrl } from "@/modules/files";
import { publicSignatureOf } from "@/modules/identity";
import { db, Prisma } from "@/platform/db";
import { ENDED_DEAL } from "./ended";
import { maskPublicText, NAME_MASK_SELECT, placeOf, VISIBLE_EXECUTOR } from "./ports";
import { CLOSED_SHOWCASE } from "./showcase";

/**
 * Оконченные сделки мастера для его публичной страницы (спека 2026-11-17): что делали, когда закончили, чем закончилось
 * и отзыв. Фото сдачи, стоимость, место и подпись под отзывом — строго по выбору покупателя (DealShowcase); нет выбора
 * (старые сделки, отзыв согласия на ПДн) — закрытый вид. Функция публичная: сессии нет, права — только выбор покупателя.
 */

export type DealHistoryPhoto = { id: string; src: string; alt: string };

export type DealHistoryItem = {
  id: string;
  title: string;
  segment: Segment | null;
  /** Переход в конечный статус: completedAt (SPLIT_PAYOUT) или cancelledAt (CANCELLED, REFUNDED); нет — updatedAt. */
  endedAt: Date;
  outcome: "success" | "failed";
  /** Только при выборе «фото»: фото сдачи (DELIVERY), одна подписанная ссылка на превью (нет превью — исходник). */
  photos: DealHistoryPhoto[];
  /** Только при выборе «стоимость». */
  priceTiyn: bigint | null;
  /** Город заявки, если покупатель разрешил показать место (прежние «город и район» и «город, район и ЖК» — тоже город); null — не показывать. */
  place: string | null;
  /** text — через маску публичного текста; signedAs — снимок выбора или инициал автора, без ФИО — пусто. */
  review: { rating: number; text: string; signedAs: string; createdAt: Date } | null;
};

export const DEAL_HISTORY_LIMIT = 20;
const DEAL_HISTORY_MAX = 50;
/** Ссылка на фото живёт час: страница мастера открыта гостем дольше, чем 15 минут ссылки для сторон сделки. */
const PHOTO_URL_TTL_SEC = 60 * 60;

/** Оконченная с офертой — то же правило, что isEndedSigned. */
const ENDED_SIGNED = { status: { in: [...ENDED_DEAL] }, signedAt: { not: null } } satisfies Prisma.DealWhereInput;

const HISTORY_SELECT = {
  id: true,
  title: true,
  status: true,
  priceTiyn: true,
  completedAt: true,
  cancelledAt: true,
  updatedAt: true,
  // Request.address (улица и дом) не выбирается: на странице мастера его нет ни при каком выборе.
  request: { select: { segment: true, city: true } },
  showcase: { select: { photos: true, price: true, address: true, signature: true, signedAs: true } },
  review: { select: { rating: true, text: true, createdAt: true, author: { select: { fullName: true } } } },
  // Фото сдачи база отдаёт, только если покупатель разрешил их показать.
  deliveryPhotos: {
    where: { purpose: "DELIVERY", deal: { showcase: { photos: true } } },
    select: { id: true, provider: true, storageKey: true, previewKey: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.DealSelect;

type HistoryRow = Prisma.DealGetPayload<{ select: typeof HISTORY_SELECT }>;

const endedAtOf = (row: HistoryRow): Date => (row.status === "SPLIT_PAYOUT" ? row.completedAt : row.cancelledAt) ?? row.updatedAt;

/**
 * До `limit` оконченных с офертой сделок видимого мастера, новые выше. Три запроса на любой лимит: мастер, id по времени
 * окончания, сделки с отзывами и фото; ссылки на фото подписываются без обращения к базе.
 */
export async function listExecutorDealHistory(executorId: string, opts: { limit?: number } = {}): Promise<DealHistoryItem[]> {
  const take = Math.min(Math.max(Math.trunc(opts.limit ?? DEAL_HISTORY_LIMIT), 1), DEAL_HISTORY_MAX);
  const executor = await db.executorProfile.findFirst({ where: { id: executorId, ...VISIBLE_EXECUTOR }, select: NAME_MASK_SELECT });
  if (!executor) return [];

  // Сортировка по времени окончания (оно в разных колонках) — в базе, чтобы лимит брал самые новые.
  const ordered = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Deal"
    WHERE "executorId" = ${executorId} AND "signedAt" IS NOT NULL AND "status"::text IN (${Prisma.join(ENDED_DEAL)})
    ORDER BY COALESCE(CASE WHEN "status" = 'SPLIT_PAYOUT' THEN "completedAt" ELSE "cancelledAt" END, "updatedAt") DESC, "id" DESC
    LIMIT ${take}`;
  if (ordered.length === 0) return [];

  const rows = await db.deal.findMany({ where: { id: { in: ordered.map((r) => r.id) }, executorId, ...ENDED_SIGNED }, select: HISTORY_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const mask = (text: string) => maskPublicText(text, executor).text;

  return Promise.all(
    ordered.flatMap(({ id }) => {
      const row = byId.get(id);
      return row ? [toItem(row, mask)] : [];
    }),
  );
}

async function toItem(row: HistoryRow, mask: (text: string) => string): Promise<DealHistoryItem> {
  const choice = row.showcase ?? { ...CLOSED_SHOWCASE, signedAs: "" };
  const title = mask(row.title);
  const files = choice.photos ? row.deliveryPhotos : [];
  const photos = await Promise.all(
    files.map(async (f, i) => ({ id: f.id, src: await previewUrl(f, { expiresInSec: PHOTO_URL_TTL_SEC }), alt: ru.companies.photoAlt(title, i + 1) })),
  );
  const place = placeOf(row.request, choice.address);
  return {
    id: row.id,
    title,
    segment: row.request.segment,
    endedAt: endedAtOf(row),
    outcome: row.status === "SPLIT_PAYOUT" ? "success" : "failed",
    photos,
    priceTiyn: choice.price ? row.priceTiyn : null,
    place: place === null ? null : mask(place),
    review: row.review
      ? {
          rating: row.review.rating,
          text: mask(row.review.text),
          // Снимок выбора («Айгерим» или «А.»); выбора нет или снимок пуст — инициал автора из его ФИО.
          signedAs: choice.signedAs || publicSignatureOf(row.review.author.fullName, "INITIAL"),
          createdAt: row.review.createdAt,
        }
      : null,
  };
}
