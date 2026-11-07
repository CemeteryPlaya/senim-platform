import "server-only";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { attachFiles } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, transaction, type Db, type Prisma } from "@/platform/db";
import { fail } from "@/platform/errors";
import { STYLES, type StyleKey } from "@/verticals/furniture";
import { parseInput } from "@/platform/validation";
import { assertActiveFurnitureTypes, requireExecutor, sanitizePublicText } from "./own";
import { DEAL_PHOTOS, itemFiles, OWN_PHOTOS, toPhotoViews } from "./photos";
import { isPlaceAllowed } from "./place";
import type { PhotoView } from "./types";

const t = ru.companies.portfolio;

export const PORTFOLIO_MAX_PHOTOS = 10;
export const PORTFOLIO_TITLE_MAX = 120;
export const PORTFOLIO_DESCRIPTION_MAX = 2000;
export const PLACE_MIN = 2;
export const PLACE_MAX = 80;

const STYLE_KEYS = Object.keys(STYLES) as [StyleKey, ...StyleKey[]];

/** Где делали: город, район или ЖК — не точный адрес (без улицы, дома, квартиры и контактов). */
export const placeField = z
  .string()
  .trim()
  .max(PLACE_MAX, ru.companies.dealPortfolio.errors.placeLength(PLACE_MIN, PLACE_MAX))
  .refine(isPlaceAllowed, ru.companies.dealPortfolio.errors.place);

export const portfolioInputSchema = z.object({
  furnitureTypeId: z.string().min(1, t.errors.type),
  style: z.enum(STYLE_KEYS, t.errors.style),
  title: z.string().trim().min(3, t.errors.title(3, PORTFOLIO_TITLE_MAX)).max(PORTFOLIO_TITLE_MAX, t.errors.title(3, PORTFOLIO_TITLE_MAX)),
  description: z.string().trim().max(PORTFOLIO_DESCRIPTION_MAX, t.errors.description(PORTFOLIO_DESCRIPTION_MAX)),
  priceFrom: z.number().int(t.errors.price).min(0, t.errors.price).max(1_000_000_000, t.errors.price).nullable(),
  published: z.boolean(),
  /** В обычной работе место необязательно. */
  place: placeField.default(""),
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
  place: string;
  /** Работа из сделки на площадке: показ заказчикам — только с согласия заказчика. */
  fromDeal: { dealId: string; dealNumber: number; consent: boolean } | null;
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
  place: true,
  createdAt: true,
  furnitureType: { select: { id: true, name: true } },
  deal: { select: { id: true, number: true, portfolioConsentAt: true } },
  photos: OWN_PHOTOS,
  dealPhotos: DEAL_PHOTOS,
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
    place: row.place,
    fromDeal: row.deal ? { dealId: row.deal.id, dealNumber: row.deal.number, consent: row.deal.portfolioConsentAt !== null } : null,
    photos: await toPhotoViews(itemFiles(row), (n) => ru.companies.photoAlt(row.title, n)),
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
export async function cleanTexts(client: Db, executorId: string, input: { title: string; description: string }) {
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
      data: {
        executorId,
        furnitureTypeId: input.furnitureTypeId,
        style: input.style,
        priceFrom: input.priceFrom,
        published: input.published,
        place: input.place,
        title: texts.title,
        description: texts.description,
      },
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
      data: {
        furnitureTypeId: input.furnitureTypeId,
        style: input.style,
        priceFrom: input.priceFrom,
        published: input.published,
        place: input.place,
        title: texts.title,
        description: texts.description,
      },
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
 * Прикрепить фото, загруженные исполнителем через uploader: files.attachFiles (только свои, PORTFOLIO,
 * ещё ни к чему не привязанные; дописываются в конец). Повтор или гонка не привяжут файл дважды.
 */
export async function attachPortfolioPhotos(user: CurrentUser, itemId: string, fileIds: readonly string[]): Promise<void> {
  const { executorId } = requireExecutor(user);
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return;
  await transaction(async (tx) => {
    await requireOwnItem(tx, executorId, itemId);
    const already = (await tx.storedFile.count({ where: { portfolioItemId: itemId } })) + (await tx.portfolioDealPhoto.count({ where: { portfolioItemId: itemId } }));
    if (already + ids.length > PORTFOLIO_MAX_PHOTOS) fail.validation(t.errors.tooManyPhotos(PORTFOLIO_MAX_PHOTOS));
    await attachFiles(tx, { fileIds: ids, uploadedById: user.id, owner: { portfolioItemId: itemId } });
    await recordAudit(tx, audit(user, executorId, itemId, "portfolio.photos_added", { count: ids.length }));
  });
}

/**
 * Открепить фото от своей работы. Сам файл остаётся у загрузившего (его чистит модуль files);
 * итоговое фото сделки — убирается только ссылка, файл этапа не трогается.
 */
export async function removePortfolioPhoto(user: CurrentUser, itemId: string, fileId: string): Promise<void> {
  const { executorId } = requireExecutor(user);
  await transaction(async (tx) => {
    await requireOwnItem(tx, executorId, itemId);
    const own = await tx.storedFile.updateMany({ where: { id: fileId, portfolioItemId: itemId }, data: { portfolioItemId: null } });
    const linked = own.count === 1 ? own : await tx.portfolioDealPhoto.deleteMany({ where: { portfolioItemId: itemId, fileId } });
    if (linked.count !== 1) fail.notFound(t.errors.photoNotFound);
    await recordAudit(tx, audit(user, executorId, itemId, "portfolio.photo_removed"));
  });
}
