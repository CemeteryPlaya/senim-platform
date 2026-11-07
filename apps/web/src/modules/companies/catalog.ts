import "server-only";
import { ru } from "@/i18n/ru";
import { db, type Db, type Prisma } from "@/platform/db";
import { PUBLIC_EXECUTOR_SELECT, toPublicView } from "./anonymity";
import { priceRange, type CatalogFilter } from "./catalog-filter";
import type { ExecutorIdentityMode } from "./display";
import { getExecutorIdentityMode } from "./identity-mode";
import { maskContacts, maskIdentity } from "./mask";
import { DEAL_PHOTOS, itemFiles, OWN_PHOTOS, toPhotoViews } from "./photos";
import { styleView } from "./portfolio";
import type { PortfolioCard, PublicExecutorPage, PublicExecutorView, PublicReview } from "./types";

/**
 * Публичная часть: каталог работ, страница исполнителя, отзывы, работа для «Хочу похожее».
 * Видно только опубликованное у подтверждённых и не заблокированных исполнителей, по включённым типам мебели.
 * Исполнитель везде — через toPublicView (без телефона и ИИН/БИН; наименование — по режиму №6).
 */
export const CATALOG_PAGE_SIZE = 12;
const PUBLIC_PAGE_PORTFOLIO_LIMIT = 24;
const REVIEWS_LIMIT = 20;

export const VISIBLE_EXECUTOR = { status: "APPROVED", user: { blockedAt: null } } satisfies Prisma.ExecutorProfileWhereInput;
/**
 * Работа из сделки (dealId) — только с согласием заказчика сделки (встреча 31.10, п. 3): без него это черновик исполнителя.
 * Единственное правило видимости: каталог, страница исполнителя, «Вдохновение» и «Хочу похожее» берут его отсюда.
 */
export const VISIBLE_ITEM = {
  published: true,
  executor: VISIBLE_EXECUTOR,
  furnitureType: { active: true },
  OR: [{ dealId: null }, { deal: { portfolioConsentAt: { not: null } } }],
} satisfies Prisma.PortfolioItemWhereInput;

export const CARD_SELECT = {
  id: true,
  title: true,
  description: true,
  style: true,
  priceFrom: true,
  place: true,
  featured: true,
  dealId: true,
  executorId: true,
  furnitureTypeId: true,
  furnitureType: { select: { slug: true, name: true } },
  photos: OWN_PHOTOS,
  dealPhotos: DEAL_PHOTOS,
  deal: { select: { review: { select: { id: true, rating: true, text: true } } } },
  executor: { select: PUBLIC_EXECUTOR_SELECT },
} satisfies Prisma.PortfolioItemSelect;

export type CardRow = Prisma.PortfolioItemGetPayload<{ select: typeof CARD_SELECT }>;

export async function toCard(row: CardRow, mode: ExecutorIdentityMode): Promise<PortfolioCard> {
  const view = toPublicView(row.executor, mode);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    furnitureType: row.furnitureType,
    style: styleView(row.style),
    priceFrom: row.priceFrom,
    place: row.place,
    featured: row.featured,
    doneOnPlatform: row.dealId !== null,
    reviewId: row.deal?.review?.id ?? null,
    photos: await toPhotoViews(itemFiles(row), (n) => ru.companies.photoAlt(row.title, n)),
    executor: { id: view.id, publicNumber: view.publicNumber, label: view.label, segment: view.segment, ratingAvg: view.ratingAvg, reviewsCount: view.reviewsCount },
  };
}

const ORDER = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.PortfolioItemOrderByWithRelationInput[];

export async function listCatalog(filter: CatalogFilter): Promise<{ items: PortfolioCard[]; total: number; page: number; pageCount: number }> {
  const where: Prisma.PortfolioItemWhereInput = {
    ...VISIBLE_ITEM,
    style: filter.style,
    priceFrom: filter.price ? priceRange(filter.price) : undefined,
    furnitureType: { active: true, slug: filter.type },
    executor: { ...VISIBLE_EXECUTOR, segment: filter.segment },
  };
  const [total, rows, mode] = await Promise.all([
    db.portfolioItem.count({ where }),
    db.portfolioItem.findMany({ where, orderBy: ORDER, skip: (filter.page - 1) * CATALOG_PAGE_SIZE, take: CATALOG_PAGE_SIZE, select: CARD_SELECT }),
    getExecutorIdentityMode(),
  ]);
  return { items: await Promise.all(rows.map((row) => toCard(row, mode))), total, page: filter.page, pageCount: Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)) };
}

/** Опубликованные работы исполнителя — для публичной страницы и миниатюр в карточке отклика. */
export async function listPublicPortfolio(executorId: string, limit = PUBLIC_PAGE_PORTFOLIO_LIMIT): Promise<PortfolioCard[]> {
  const [rows, mode] = await Promise.all([
    db.portfolioItem.findMany({ where: { ...VISIBLE_ITEM, executorId }, orderBy: ORDER, take: limit, select: CARD_SELECT }),
    getExecutorIdentityMode(),
  ]);
  return Promise.all(rows.map((row) => toCard(row, mode)));
}

/** Отзывы об исполнителе: оценка, текст без контактов, дата. Автор не показывается. */
export async function listExecutorReviews(executorId: string, limit = REVIEWS_LIMIT): Promise<PublicReview[]> {
  const rows = await db.review.findMany({
    where: { executorId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, rating: true, text: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, text: maskContacts(r.text).text }));
}

/** Публичная страница /executors/[publicNumber]. null — исполнителя нет или он не подтверждён. */
export async function getPublicExecutorPage(publicNumber: number): Promise<PublicExecutorPage | null> {
  const row = await db.executorProfile.findFirst({
    where: { publicNumber, ...VISIBLE_EXECUTOR },
    select: { ...PUBLIC_EXECUTOR_SELECT, about: true },
  });
  if (!row) return null;
  const { about, ...publicRow } = row;
  const [portfolio, reviews, mode] = await Promise.all([listPublicPortfolio(row.id), listExecutorReviews(row.id), getExecutorIdentityMode()]);
  // «О себе» сохраняется уже очищенным, но демо-данные и старые записи могли обойти форму — чистим и при показе.
  return { view: toPublicView(publicRow, mode), about: maskIdentity(maskContacts(about).text, row.legalName), portfolio, reviews };
}

export type PortfolioForRequest = PortfolioCard & { furnitureTypeId: string; executor: PublicExecutorView };

/**
 * Для мастера заявки (marketplace): /requests/new?like=<portfolioItemId> — прямая заявка исполнителю этой работы.
 * null — работы нет, она снята с публикации или исполнитель не подтверждён.
 */
export async function getPortfolioForRequest(portfolioItemId: string): Promise<PortfolioForRequest | null> {
  const [row, mode] = await Promise.all([
    db.portfolioItem.findFirst({ where: { id: portfolioItemId, ...VISIBLE_ITEM }, select: CARD_SELECT }),
    getExecutorIdentityMode(),
  ]);
  if (!row) return null;
  return { ...(await toCard(row, mode)), furnitureTypeId: row.furnitureTypeId, executor: toPublicView(row.executor, mode) };
}

/**
 * Работа для «Хочу похожее» по тому же правилу видимости, что и каталог (опубликована, исполнитель
 * подтверждён и не заблокирован, тип мебели включён). client — транзакция вызывающего или db.
 * executorId — только для серверной записи заявки; на экран идёт executor (номер и сегмент).
 * viewerId — кто заказывает: своя работа (тот же человек в роли исполнителя, ADR-004) не найдётся —
 * самосделка запрещена.
 */
export async function findLikeablePortfolioItem(client: Db, portfolioItemId: string, viewerId: string) {
  return client.portfolioItem.findFirst({
    where: { id: portfolioItemId, ...VISIBLE_ITEM, AND: [{ executor: { userId: { not: viewerId } } }] },
    select: { id: true, title: true, style: true, furnitureTypeId: true, executorId: true, executor: { select: { publicNumber: true, segment: true } } },
  });
}

export async function getCatalogFacets(): Promise<{ types: { slug: string; name: string }[] }> {
  const types = await db.furnitureType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { slug: true, name: true } });
  return { types };
}
