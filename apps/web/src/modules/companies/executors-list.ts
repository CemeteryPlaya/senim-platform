import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { db, type Prisma } from "@/platform/db";
import { EXECUTOR_DISPLAY_SELECT } from "./anonymity";
import { NAME_MASK_SELECT, VISIBLE_EXECUTOR, VISIBLE_ITEM } from "./catalog";
import { executorStats, type ExecutorStats } from "./deal-stats";
import { executorDisplay } from "./display";
import { highlightCovers, type Mask } from "./highlights";
import { getExecutorIdentityMode } from "./identity-mode";
import { maskPublicText } from "./mask";
import { OWN_PHOTOS, toPhotoViews } from "./photos";

/** Мастеров на странице общего списка по умолчанию — как работ в каталоге. */
export const EXECUTORS_PAGE_SIZE = 12;
const PER_PAGE_MAX = 48;

/**
 * Карточка мастера в общем списке. Мастер — по режиму показа имени (ADR-006, `executorDisplay`): по умолчанию
 * «Исполнитель №N»; телефона, Instagram, ИИН/БИН, адреса и внутреннего id нет.
 */
export type ExecutorListItem = {
  publicNumber: number;
  label: string;
  segment: Segment | null;
  ratingAvg: number;
  reviewsCount: number;
  stats: ExecutorStats;
  /** Первая лучшая работа с фото, иначе последняя опубликованная работа вне площадки с фото; нет — null. */
  cover: { src: string; alt: string } | null;
};

const LIST_SELECT = {
  id: true,
  ...EXECUTOR_DISPLAY_SELECT,
  ...NAME_MASK_SELECT,
  segment: true,
  ratingAvg: true,
  reviewsCount: true,
} satisfies Prisma.ExecutorProfileSelect;
type ListRow = Prisma.ExecutorProfileGetPayload<{ select: typeof LIST_SELECT }>;
type Ranked = { row: ListRow; stats: ExecutorStats };

/** Порядок списка: с отзывами выше, затем рейтинг, затем успешные сделки, затем публичный номер (стабильно). */
function byRank(a: Ranked, b: Ranked): number {
  return (
    Number(b.row.reviewsCount > 0) - Number(a.row.reviewsCount > 0) ||
    b.row.ratingAvg - a.row.ratingAvg ||
    b.stats.successful - a.stats.successful ||
    a.row.publicNumber - b.row.publicNumber
  );
}

/** Последняя опубликованная работа вне площадки с фото — у каждого мастера страницы, одним запросом. */
async function latestWorkCovers(executorIds: readonly string[], maskOf: (executorId: string) => Mask): Promise<Map<string, { src: string; alt: string }>> {
  const covers = new Map<string, { src: string; alt: string }>();
  if (executorIds.length === 0) return covers;
  const rows = await db.portfolioItem.findMany({
    where: { ...VISIBLE_ITEM, dealId: null, executorId: { in: [...executorIds] }, photos: { some: {} } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["executorId"],
    select: { executorId: true, title: true, photos: { ...OWN_PHOTOS, take: 1 } },
  });
  await Promise.all(
    rows.map(async (row) => {
      const title = maskOf(row.executorId)(row.title);
      const [photo] = await toPhotoViews(row.photos, (n) => ru.companies.photoAlt(title, n));
      const src = photo?.thumb ?? photo?.src;
      if (src) covers.set(row.executorId, { src, alt: photo.alt });
    }),
  );
  return covers;
}

/**
 * Общий список мастеров (открыт гостю): только видимые мастера (`VISIBLE_EXECUTOR`), порядок — `byRank`, страница —
 * после сортировки, `total` — все видимые.
 *
 * Сортировка в памяти по всем видимым мастерам: ключ «успешные сделки» считает `executorStats` (сделки с офертой) — то
 * же правило, что на странице мастера; повторять его в SQL значило бы держать два правила. На масштабе MVP (сотни
 * мастеров) это два лёгких запроса; при росте — перенести ранжирование в SQL (LEFT JOIN подсчёта успешных сделок).
 * Обложки — только для мастеров страницы, пакетно (без запроса на каждого).
 */
export async function listExecutors(opts: { page: number; perPage?: number }): Promise<{ items: ExecutorListItem[]; total: number }> {
  const page = Number.isInteger(opts.page) && opts.page >= 1 ? opts.page : 1;
  const perPage = Math.min(Math.max(Math.trunc(opts.perPage ?? EXECUTORS_PAGE_SIZE), 1), PER_PAGE_MAX);
  const [rows, mode] = await Promise.all([db.executorProfile.findMany({ where: VISIBLE_EXECUTOR, select: LIST_SELECT }), getExecutorIdentityMode()]);
  const stats = await executorStats(rows.map((r) => r.id));
  const empty: ExecutorStats = { deals: 0, ended: 0, successful: 0, successRate: null };
  const ranked = rows.map((row) => ({ row, stats: stats.get(row.id) ?? empty })).sort(byRank);
  const slice = ranked.slice((page - 1) * perPage, page * perPage);

  const byId = new Map(slice.map((r) => [r.row.id, r.row]));
  // Название работы в подписи фото — без имени и контактов мастера, как на его странице.
  const maskOf = (executorId: string): Mask => {
    const row = byId.get(executorId);
    return (text) => (row ? maskPublicText(text, row).text : text);
  };
  const ids = slice.map((r) => r.row.id);
  const highlighted = await highlightCovers(ids, maskOf);
  const fallback = await latestWorkCovers(
    ids.filter((id) => !highlighted.has(id)),
    maskOf,
  );

  const items = slice.map(({ row, stats: s }): ExecutorListItem => ({
    publicNumber: row.publicNumber,
    label: executorDisplay(row, mode).label,
    segment: row.segment,
    ratingAvg: row.ratingAvg,
    reviewsCount: row.reviewsCount,
    stats: s,
    cover: highlighted.get(row.id) ?? fallback.get(row.id) ?? null,
  }));
  return { items, total: rows.length };
}
