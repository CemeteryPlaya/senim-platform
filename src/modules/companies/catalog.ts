import "server-only";
import { ru } from "@/i18n/ru";
import { db, type Db, type Prisma } from "@/platform/db";
import { PUBLIC_EXECUTOR_SELECT, toPublicView } from "./anonymity";
import { priceRange, type CatalogFilter } from "./catalog-filter";
import { maskContacts, maskIdentity } from "./mask";
import { PHOTO_SELECT, toPhotoViews } from "./photos";
import { styleView } from "./portfolio";
import type { PortfolioCard, PublicExecutorPage, PublicExecutorView, PublicReview } from "./types";

/**
 * Публичная часть: каталог работ, страница исполнителя, отзывы, работа для «Хочу похожее».
 * Видно только опубликованное у подтверждённых и не заблокированных исполнителей, по включённым типам мебели.
 * Исполнитель везде — через PUBLIC_EXECUTOR_SELECT (без наименования, ФИО, телефона, ИИН/БИН).
 */
export const CATALOG_PAGE_SIZE = 12;
const PUBLIC_PAGE_PORTFOLIO_LIMIT = 24;
const REVIEWS_LIMIT = 20;

const VISIBLE_EXECUTOR = { status: "APPROVED", user: { blockedAt: null } } satisfies Prisma.ExecutorProfileWhereInput;
const VISIBLE_ITEM = { published: true, executor: VISIBLE_EXECUTOR, furnitureType: { active: true } } satisfies Prisma.PortfolioItemWhereInput;

const CARD_SELECT = {
  id: true,
  title: true,
  description: true,
  style: true,
  priceFrom: true,
  furnitureTypeId: true,
  furnitureType: { select: { slug: true, name: true } },
  photos: { select: PHOTO_SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  executor: { select: PUBLIC_EXECUTOR_SELECT },
} satisfies Prisma.PortfolioItemSelect;

type CardRow = Prisma.PortfolioItemGetPayload<{ select: typeof CARD_SELECT }>;

async function toCard(row: CardRow): Promise<PortfolioCard> {
  const view = toPublicView(row.executor);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    furnitureType: row.furnitureType,
    style: styleView(row.style),
    priceFrom: row.priceFrom,
    photos: await toPhotoViews(row.photos, (n) => ru.companies.photoAlt(row.title, n)),
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
  const [total, rows] = await Promise.all([
    db.portfolioItem.count({ where }),
    db.portfolioItem.findMany({ where, orderBy: ORDER, skip: (filter.page - 1) * CATALOG_PAGE_SIZE, take: CATALOG_PAGE_SIZE, select: CARD_SELECT }),
  ]);
  return { items: await Promise.all(rows.map(toCard)), total, page: filter.page, pageCount: Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)) };
}

/** Опубликованные работы исполнителя — для публичной страницы и миниатюр в карточке отклика. */
export async function listPublicPortfolio(executorId: string, limit = PUBLIC_PAGE_PORTFOLIO_LIMIT): Promise<PortfolioCard[]> {
  const rows = await db.portfolioItem.findMany({ where: { ...VISIBLE_ITEM, executorId }, orderBy: ORDER, take: limit, select: CARD_SELECT });
  return Promise.all(rows.map(toCard));
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
    select: { ...PUBLIC_EXECUTOR_SELECT, about: true, legalName: true },
  });
  if (!row) return null;
  const { about, legalName, ...publicRow } = row;
  const [portfolio, reviews] = await Promise.all([listPublicPortfolio(row.id), listExecutorReviews(row.id)]);
  // «О себе» сохраняется уже очищенным, но демо-данные и старые записи могли обойти форму — чистим и при показе.
  return { view: toPublicView(publicRow), about: maskIdentity(maskContacts(about).text, legalName), portfolio, reviews };
}

export type PortfolioForRequest = PortfolioCard & { furnitureTypeId: string; executor: PublicExecutorView };

/**
 * Для мастера заявки (marketplace): /requests/new?like=<portfolioItemId> — прямая заявка исполнителю этой работы.
 * null — работы нет, она снята с публикации или исполнитель не подтверждён.
 */
export async function getPortfolioForRequest(portfolioItemId: string): Promise<PortfolioForRequest | null> {
  const row = await db.portfolioItem.findFirst({ where: { id: portfolioItemId, ...VISIBLE_ITEM }, select: CARD_SELECT });
  if (!row) return null;
  return { ...(await toCard(row)), furnitureTypeId: row.furnitureTypeId, executor: toPublicView(row.executor) };
}

/**
 * Работа для «Хочу похожее» по тому же правилу видимости, что и каталог (опубликована, исполнитель
 * подтверждён и не заблокирован, тип мебели включён). client — транзакция вызывающего или db.
 * executorId — только для серверной записи заявки; на экран идёт executor (номер и сегмент).
 */
export async function findLikeablePortfolioItem(client: Db, portfolioItemId: string) {
  return client.portfolioItem.findFirst({
    where: { id: portfolioItemId, ...VISIBLE_ITEM },
    select: { id: true, title: true, style: true, furnitureTypeId: true, executorId: true, executor: { select: { publicNumber: true, segment: true } } },
  });
}

export async function getCatalogFacets(): Promise<{ types: { slug: string; name: string }[] }> {
  const types = await db.furnitureType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { slug: true, name: true } });
  return { types };
}
