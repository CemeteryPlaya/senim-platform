import "server-only";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, transaction, type Db, type Prisma } from "@/platform/db";
import { fail } from "@/platform/errors";
import { STYLES, type StyleKey } from "@/verticals/furniture";
import { assertActiveFurnitureTypes, parseInput, requireExecutor, sanitizePublicText } from "./own";
import { PHOTO_SELECT, toPhotoViews } from "./photos";
import type { PhotoView } from "./types";

const t = ru.companies.portfolio;

export const PORTFOLIO_MAX_PHOTOS = 10;
export const PORTFOLIO_TITLE_MAX = 120;
export const PORTFOLIO_DESCRIPTION_MAX = 2000;

const STYLE_KEYS = Object.keys(STYLES) as [StyleKey, ...StyleKey[]];

export const portfolioInputSchema = z.object({
  furnitureTypeId: z.string().min(1, t.errors.type),
  style: z.enum(STYLE_KEYS, t.errors.style),
  title: z.string().trim().min(3, t.errors.title(3, PORTFOLIO_TITLE_MAX)).max(PORTFOLIO_TITLE_MAX, t.errors.title(3, PORTFOLIO_TITLE_MAX)),
  description: z.string().trim().max(PORTFOLIO_DESCRIPTION_MAX, t.errors.description(PORTFOLIO_DESCRIPTION_MAX)),
  priceFrom: z.number().int(t.errors.price).min(0, t.errors.price).max(1_000_000_000, t.errors.price).nullable(),
  published: z.boolean(),
});

export type PortfolioInput = z.input<typeof portfolioInputSchema>;

export type OwnPortfolioItem = {
  id: string;
  title: string;
  description: string;
  furnitureType: { id: string; name: string };
  style: { key: string; name: string };
  priceFrom: number | null;
  published: boolean;
  photos: PhotoView[];
  createdAt: Date;
};

const ITEM_SELECT = {
  id: true,
  title: true,
  description: true,
  style: true,
  priceFrom: true,
  published: true,
  createdAt: true,
  furnitureType: { select: { id: true, name: true } },
  photos: { select: PHOTO_SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.PortfolioItemSelect;

type ItemRow = Prisma.PortfolioItemGetPayload<{ select: typeof ITEM_SELECT }>;

export function styleView(key: string): { key: string; name: string } {
  return { key, name: key in STYLES ? STYLES[key as StyleKey].name : key };
}

async function toOwnItem(row: ItemRow): Promise<OwnPortfolioItem> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    furnitureType: row.furnitureType,
    style: styleView(row.style),
    priceFrom: row.priceFrom,
    published: row.published,
    photos: await toPhotoViews(row.photos, (n) => ru.companies.photoAlt(row.title, n)),
    createdAt: row.createdAt,
  };
}

/** Чужая или несуществующая работа — одинаково NOT_FOUND. */
async function requireOwnItem(client: Db, executorId: string, itemId: string) {
  const item = await client.portfolioItem.findFirst({ where: { id: itemId, executorId }, select: { id: true, published: true, title: true } });
  if (!item) return fail.notFound(t.errors.notFound);
  return item;
}

function audit(user: CurrentUser, executorId: string, itemId: string, action: string, after?: Record<string, string | number | boolean | null>) {
  return { actor: actorOf(user), action, entity: { type: "portfolio_item", id: itemId }, scope: `executor:${executorId}`, after };
}

export async function listOwnPortfolio(user: CurrentUser): Promise<OwnPortfolioItem[]> {
  const { executorId } = requireExecutor(user);
  const rows = await db.portfolioItem.findMany({ where: { executorId }, orderBy: { createdAt: "desc" }, select: ITEM_SELECT });
  return Promise.all(rows.map(toOwnItem));
}

export async function getOwnPortfolioItem(user: CurrentUser, itemId: string): Promise<OwnPortfolioItem> {
  const { executorId } = requireExecutor(user);
  const row = await db.portfolioItem.findFirst({ where: { id: itemId, executorId }, select: ITEM_SELECT });
  if (!row) return fail.notFound(t.errors.notFound);
  return toOwnItem(row);
}

/** Тексты работы видят заказчики: контакты и наименование исполнителя скрываются. */
async function cleanTexts(client: Db, executorId: string, input: z.output<typeof portfolioInputSchema>) {
  const title = await sanitizePublicText(client, executorId, input.title);
  const description = await sanitizePublicText(client, executorId, input.description);
  return { title: title.text, description: description.text, masked: title.masked || description.masked };
}

export async function createPortfolioItem(user: CurrentUser, raw: PortfolioInput): Promise<{ id: string; masked: boolean }> {
  const { executorId } = requireExecutor(user);
  const input = parseInput(portfolioInputSchema, raw);
  return transaction(async (tx) => {
    await assertActiveFurnitureTypes(tx, [input.furnitureTypeId]);
    const texts = await cleanTexts(tx, executorId, input);
    const item = await tx.portfolioItem.create({
      data: { executorId, furnitureTypeId: input.furnitureTypeId, style: input.style, priceFrom: input.priceFrom, published: input.published, title: texts.title, description: texts.description },
    });
    await recordAudit(tx, audit(user, executorId, item.id, "portfolio.created", { published: input.published }));
    return { id: item.id, masked: texts.masked };
  });
}

export async function updatePortfolioItem(user: CurrentUser, itemId: string, raw: PortfolioInput): Promise<{ masked: boolean }> {
  const { executorId } = requireExecutor(user);
  const input = parseInput(portfolioInputSchema, raw);
  return transaction(async (tx) => {
    await requireOwnItem(tx, executorId, itemId);
    await assertActiveFurnitureTypes(tx, [input.furnitureTypeId]);
    const texts = await cleanTexts(tx, executorId, input);
    await tx.portfolioItem.update({
      where: { id: itemId },
      data: { furnitureTypeId: input.furnitureTypeId, style: input.style, priceFrom: input.priceFrom, published: input.published, title: texts.title, description: texts.description },
    });
    await recordAudit(tx, audit(user, executorId, itemId, "portfolio.updated", { published: input.published }));
    return { masked: texts.masked };
  });
}

export async function setPortfolioPublished(user: CurrentUser, itemId: string, published: boolean): Promise<void> {
  const { executorId } = requireExecutor(user);
  await transaction(async (tx) => {
    const item = await requireOwnItem(tx, executorId, itemId);
    if (item.published === published) return;
    await tx.portfolioItem.update({ where: { id: itemId }, data: { published } });
    await recordAudit(tx, audit(user, executorId, itemId, published ? "portfolio.published" : "portfolio.unpublished"));
  });
}

/** Удаление. Если по работе есть заявки «Хочу похожее» — нельзя: связь нужна заявке, работу можно только снять с публикации. */
export async function deletePortfolioItem(user: CurrentUser, itemId: string): Promise<void> {
  const { executorId } = requireExecutor(user);
  await transaction(async (tx) => {
    const item = await requireOwnItem(tx, executorId, itemId);
    if ((await tx.request.count({ where: { portfolioItemId: itemId } })) > 0) fail.conflict(t.errors.hasRequests);
    await tx.portfolioItem.delete({ where: { id: itemId } });
    await recordAudit(tx, audit(user, executorId, itemId, "portfolio.deleted", { title: item.title }));
  });
}

/**
 * Прикрепить фото, загруженные исполнителем через uploader (purpose PORTFOLIO, ещё ни к чему не привязаны).
 * Условие владения — в самом UPDATE: повтор или гонка не привяжут файл дважды.
 */
export async function attachPortfolioPhotos(user: CurrentUser, itemId: string, fileIds: readonly string[]): Promise<void> {
  const { executorId } = requireExecutor(user);
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return;
  await transaction(async (tx) => {
    await requireOwnItem(tx, executorId, itemId);
    const already = await tx.storedFile.count({ where: { portfolioItemId: itemId } });
    if (already + ids.length > PORTFOLIO_MAX_PHOTOS) fail.validation(t.errors.tooManyPhotos(PORTFOLIO_MAX_PHOTOS));
    const result = await tx.storedFile.updateMany({
      where: {
        id: { in: ids },
        uploadedById: user.id,
        purpose: "PORTFOLIO",
        portfolioItemId: null,
        messageId: null,
        requestId: null,
        stageId: null,
        disputeId: null,
        visualizationId: null,
      },
      data: { portfolioItemId: itemId },
    });
    if (result.count !== ids.length) fail.validation(t.errors.badPhoto);
    for (const [i, id] of ids.entries()) {
      await tx.storedFile.update({ where: { id }, data: { sortOrder: already + i } });
    }
    await recordAudit(tx, audit(user, executorId, itemId, "portfolio.photos_added", { count: ids.length }));
  });
}

/** Открепить фото от своей работы. Сам файл остаётся у загрузившего (его чистит модуль files). */
export async function removePortfolioPhoto(user: CurrentUser, itemId: string, fileId: string): Promise<void> {
  const { executorId } = requireExecutor(user);
  await transaction(async (tx) => {
    await requireOwnItem(tx, executorId, itemId);
    const result = await tx.storedFile.updateMany({ where: { id: fileId, portfolioItemId: itemId }, data: { portfolioItemId: null } });
    if (result.count !== 1) fail.notFound(t.errors.photoNotFound);
    await recordAudit(tx, audit(user, executorId, itemId, "portfolio.photo_removed"));
  });
}
