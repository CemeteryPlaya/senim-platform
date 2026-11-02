import "server-only";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db, type Prisma } from "@/platform/db";
import { EXECUTOR_DISPLAY_SELECT } from "./anonymity";
import { CARD_SELECT, toCard, VISIBLE_ITEM } from "./catalog";
import { executorDisplay } from "./display";
import { getExecutorIdentityMode } from "./identity-mode";
import type { InspirationFilter } from "./inspiration-filter";
import { maskContacts } from "./mask";
import { DEAL_PHOTOS, itemFiles, OWN_PHOTOS, toPhotoViews } from "./photos";
import { styleView } from "./portfolio";
import type { PhotoView, PortfolioCard } from "./types";

/**
 * «Вдохновение» (встреча 31.10, п. 2): лента фото опубликованных работ одобренных исполнителей и подборки площадки.
 * Видимость — то же правило VISIBLE_ITEM, что и в каталоге (в том числе согласие заказчика для работ из сделок).
 * Подпись исполнителя — executorDisplay по режиму показа (ADR-006); телефона и контактов нет нигде.
 */
export type InspirationTile = {
  id: string;
  title: string;
  cover: PhotoView | null;
  furnitureType: { slug: string; name: string };
  style: { key: string; name: string };
  place: string;
  featured: boolean;
  doneOnPlatform: boolean;
  executorLabel: string;
};

const TILE_SELECT = {
  id: true,
  title: true,
  style: true,
  place: true,
  featured: true,
  dealId: true,
  furnitureType: { select: { slug: true, name: true } },
  photos: { ...OWN_PHOTOS, take: 1 },
  dealPhotos: { ...DEAL_PHOTOS, take: 1 },
  executor: { select: EXECUTOR_DISPLAY_SELECT },
} satisfies Prisma.PortfolioItemSelect;

/** Сначала подборка площадки, затем новые. */
const ORDER = [{ featured: "desc" }, { createdAt: "desc" }, { id: "desc" }] satisfies Prisma.PortfolioItemOrderByWithRelationInput[];

export async function listInspiration(filter: InspirationFilter): Promise<{ items: InspirationTile[]; hasMore: boolean }> {
  const where: Prisma.PortfolioItemWhereInput = { ...VISIBLE_ITEM, style: filter.style, furnitureType: { active: true, slug: filter.type } };
  const [rows, mode] = await Promise.all([
    db.portfolioItem.findMany({ where, orderBy: ORDER, take: filter.limit + 1, select: TILE_SELECT }),
    getExecutorIdentityMode(),
  ]);
  const items = await Promise.all(
    rows.slice(0, filter.limit).map(async (row): Promise<InspirationTile> => {
      const [cover] = await toPhotoViews(itemFiles(row).slice(0, 1), (n) => ru.companies.photoAlt(row.title, n));
      return {
        id: row.id,
        title: row.title,
        cover: cover ?? null,
        furnitureType: row.furnitureType,
        style: styleView(row.style),
        place: row.place,
        featured: row.featured,
        doneOnPlatform: row.dealId !== null,
        executorLabel: executorDisplay(row.executor, mode).label,
      };
    }),
  );
  return { items, hasMore: rows.length > filter.limit };
}

export type InspirationDetail = PortfolioCard & {
  /** Отзыв заказчика по сделке этой работы, текст без контактов. */
  review: { id: string; rating: number; text: string } | null;
  /** Работа того же человека (в любой его роли, ADR-004): «Хочу похожее» на свою работу недоступно. */
  own: boolean;
  /** Показать «Хочу похожее»: гость (после входа — заявка) или человек с ролью заказчика, не своя работа. */
  canLike: boolean;
  /** Оператор ведёт подборку. */
  canFeature: boolean;
};

/** Открытая карточка «Вдохновения». null — работы нет или её нельзя показывать (правило VISIBLE_ITEM). */
export async function getInspirationItem(itemId: string, viewer: CurrentUser | null): Promise<InspirationDetail | null> {
  const [row, mode] = await Promise.all([db.portfolioItem.findFirst({ where: { id: itemId, ...VISIBLE_ITEM }, select: CARD_SELECT }), getExecutorIdentityMode()]);
  if (!row) return null;
  const review = row.deal?.review ?? null;
  const own = viewer?.executor?.id === row.executorId;
  return {
    ...(await toCard(row, mode)),
    review: review ? { id: review.id, rating: review.rating, text: maskContacts(review.text).text } : null,
    own,
    canLike: !own && (viewer === null || viewer.roles.includes("CLIENT")),
    canFeature: viewer?.role === "OPERATOR",
  };
}
