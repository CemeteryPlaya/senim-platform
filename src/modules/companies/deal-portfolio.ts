import "server-only";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { db, transaction, type Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { STYLES, type StyleKey } from "@/verticals/furniture";
import { assertActiveFurnitureTypes, requireExecutor } from "./own";
import { OWN_PHOTOS, toPhotoViews } from "./photos";
import { cleanTexts, PLACE_MAX, PLACE_MIN, placeField, PORTFOLIO_MAX_PHOTOS, portfolioInputSchema } from "./portfolio";
import type { PhotoView } from "./types";

/**
 * Портфолио из итоговых фото сделки (встреча 31.10, п. 3).
 * - Исполнитель завершённой сделки добавляет работу: фото сдачи (ссылками, не копиями),
 *   тип и стиль из заявки, место — город, район или ЖК. Одна работа на сделку (уникальный dealId).
 * - Показ заказчикам — только с согласия заказчика сделки (Deal.portfolioConsentAt). Без него работа —
 *   черновик исполнителя; правило видимости — VISIBLE_ITEM в catalog.ts. Согласие можно отозвать.
 * Фото уже без EXIF и геометок: files.processImage пережимает каждое загруженное фото без метаданных.
 */
const t = ru.companies.dealPortfolio;
/** Сделка завершена — выплата мастеру проведена (ADR-009). */
const DONE = "SPLIT_PAYOUT";
const id = z.string().min(1).max(64);

export const fromDealInputSchema = portfolioInputSchema.extend({
  dealId: id,
  fileIds: z.array(id).min(1, t.errors.noPhotos).max(PORTFOLIO_MAX_PHOTOS, ru.companies.portfolio.errors.tooManyPhotos(PORTFOLIO_MAX_PHOTOS)),
  place: placeField.refine((v) => v.length >= PLACE_MIN, t.errors.placeLength(PLACE_MIN, PLACE_MAX)),
});
export type FromDealInput = z.input<typeof fromDealInputSchema>;

export const consentSchema = z.object({ dealId: id, consent: z.boolean() });
export const featuredSchema = z.object({ itemId: id, featured: z.boolean() });

/** Итоговые фото — фото сдачи (DELIVERY), которые мастер приложил при переходе в READY. */
async function finalPhotos(client: Db, dealId: string) {
  return client.storedFile.findMany({ where: { dealId, purpose: "DELIVERY" }, ...OWN_PHOTOS });
}

/** Сделка исполнителя. Чужая или несуществующая — одинаково NOT_FOUND. */
async function executorDeal(client: Db, executorId: string, dealId: string) {
  const deal = await client.deal.findFirst({
    where: { id: dealId, executorId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      portfolioConsentAt: true,
      portfolioItem: { select: { id: true } },
      request: { select: { furnitureTypeId: true, style: true, city: true } },
    },
  });
  if (!deal) return fail.notFound(t.errors.dealNotFound);
  if (deal.status !== DONE) return fail.conflict(t.errors.notCompleted);
  return deal;
}

export type DealPortfolioDraft = {
  dealId: string;
  dealNumber: number;
  title: string;
  furnitureTypeId: string | null;
  style: StyleKey | "";
  /** Город из заявки; точный адрес заявки сюда не попадает. */
  place: string;
  photos: PhotoView[];
  existingItemId: string | null;
  consent: boolean;
};

/** Данные формы «Добавить в портфолио»: тип, стиль и город подставлены из заявки. */
export async function getDealPortfolioDraft(user: CurrentUser, dealId: string): Promise<DealPortfolioDraft> {
  const { executorId } = requireExecutor(user);
  const deal = await executorDeal(db, executorId, dealId);
  const style = deal.request.style;
  return {
    dealId: deal.id,
    dealNumber: deal.number,
    title: deal.title,
    furnitureTypeId: deal.request.furnitureTypeId,
    style: style && style in STYLES ? (style as StyleKey) : "",
    place: deal.request.city,
    photos: await toPhotoViews(await finalPhotos(db, deal.id), t.form.photoAlt),
    existingItemId: deal.portfolioItem?.id ?? null,
    consent: deal.portfolioConsentAt !== null,
  };
}

/**
 * Работа из сделки. Повтор и гонка двух запросов дают одну работу: уникальный dealId + ON CONFLICT DO NOTHING;
 * второй запрос получает ту же работу с created: false и журнал не пишет.
 */
export async function createPortfolioFromDeal(user: CurrentUser, raw: FromDealInput): Promise<{ id: string; created: boolean }> {
  const { executorId } = requireExecutor(user);
  const input = parseInput(fromDealInputSchema, raw);
  return transaction(async (tx) => {
    const deal = await executorDeal(tx, executorId, input.dealId);
    if (deal.portfolioItem) return { id: deal.portfolioItem.id, created: false };
    const allowed = new Set((await finalPhotos(tx, deal.id)).map((f) => f.id));
    const fileIds = [...new Set(input.fileIds)];
    if (!fileIds.every((f) => allowed.has(f))) fail.validation(t.errors.photosNotFromDeal);
    await assertActiveFurnitureTypes(tx, [input.furnitureTypeId]);
    const texts = await cleanTexts(tx, executorId, input);

    const [item] = await tx.portfolioItem.createManyAndReturn({
      data: [
        {
          executorId,
          dealId: deal.id,
          furnitureTypeId: input.furnitureTypeId,
          style: input.style,
          priceFrom: input.priceFrom,
          published: input.published,
          place: input.place,
          title: texts.title,
          description: texts.description,
        },
      ],
      skipDuplicates: true,
      select: { id: true },
    });
    if (!item) return { id: (await tx.portfolioItem.findUniqueOrThrow({ where: { dealId: deal.id }, select: { id: true } })).id, created: false };

    await tx.portfolioDealPhoto.createMany({ data: fileIds.map((fileId, i) => ({ portfolioItemId: item.id, fileId, sortOrder: i })) });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "portfolio.created_from_deal",
      entity: { type: "portfolio_item", id: item.id },
      scope: `executor:${executorId}`,
      after: { dealId: deal.id, photos: fileIds.length, published: input.published },
    });
    return { id: item.id, created: true };
  });
}

/**
 * Согласие заказчика показать фото (или его отзыв). Вызывается и из отзыва (deal-core.leaveReview) в его
 * транзакции. Переход — updateMany по ожидаемому состоянию: повтор и двойной клик ничего не меняют
 * и журнал второй раз не пишут.
 */
export async function applyPortfolioConsent(tx: Db, user: CurrentUser, dealId: string, consent: boolean): Promise<{ changed: boolean }> {
  if (user.role !== "CLIENT") return fail.forbidden(t.errors.onlyClient);
  const deal = await tx.deal.findFirst({
    where: { id: dealId, clientId: user.id },
    select: { id: true, number: true, status: true, executorId: true, executor: { select: { userId: true } } },
  });
  if (!deal) return fail.notFound(t.errors.dealNotFound);
  if (deal.status !== DONE) return fail.conflict(t.errors.notCompleted);

  const result = await tx.deal.updateMany({
    where: { id: deal.id, portfolioConsentAt: consent ? null : { not: null } },
    data: { portfolioConsentAt: consent ? new Date() : null },
  });
  if (result.count === 0) return { changed: false };

  const action = consent ? "portfolio.consent_given" : "portfolio.consent_revoked";
  await recordAudit(tx, { actor: actorOf(user), action, entity: { type: "deal", id: deal.id }, scope: `deal:${deal.id}`, after: { consent } });
  await notify(tx, {
    userId: deal.executor.userId,
    kind: action,
    title: consent ? t.notify.givenTitle : t.notify.revokedTitle,
    body: consent ? t.notify.givenBody(deal.number) : t.notify.revokedBody(deal.number),
    link: `/deals/${deal.id}`,
  });
  return { changed: true };
}

export async function setPortfolioConsent(user: CurrentUser, raw: z.input<typeof consentSchema>): Promise<{ changed: boolean }> {
  const input = parseInput(consentSchema, raw);
  return transaction((tx) => applyPortfolioConsent(tx, user, input.dealId, input.consent));
}

export type DealPortfolioPanel = { viewer: "CLIENT"; consent: boolean } | { viewer: "EXECUTOR"; consent: boolean; itemId: string | null; photos: number };

/**
 * Блок «Фото в портфолио» на экране завершённой сделки: заказчику — согласие, исполнителю — добавление работы.
 * Остальным и до завершения — null (блока нет, о сделке ничего не раскрывается).
 */
export async function getDealPortfolioPanel(user: CurrentUser, dealId: string): Promise<DealPortfolioPanel | null> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { status: true, clientId: true, executorId: true, portfolioConsentAt: true, portfolioItem: { select: { id: true } } },
  });
  if (!deal || deal.status !== DONE) return null;
  const consent = deal.portfolioConsentAt !== null;
  if (user.role === "CLIENT" && deal.clientId === user.id) return { viewer: "CLIENT", consent };
  if (user.role === "EXECUTOR" && user.executor?.id === deal.executorId) {
    return { viewer: "EXECUTOR", consent, itemId: deal.portfolioItem?.id ?? null, photos: (await finalPhotos(db, dealId)).length };
  }
  return null;
}

/** «В подборку» / «Убрать из подборки» — только оператор. Повтор того же состояния журнал не пишет. */
export async function setPortfolioFeatured(user: CurrentUser, raw: z.input<typeof featuredSchema>): Promise<void> {
  if (user.role !== "OPERATOR") return fail.forbidden(ru.companies.inspiration.errors.operatorOnly);
  const input = parseInput(featuredSchema, raw);
  await transaction(async (tx) => {
    const item = await tx.portfolioItem.findUnique({ where: { id: input.itemId }, select: { executorId: true } });
    if (!item) return fail.notFound(ru.companies.portfolio.errors.notFound);
    const result = await tx.portfolioItem.updateMany({ where: { id: input.itemId, featured: !input.featured }, data: { featured: input.featured } });
    if (result.count === 0) return;
    await recordAudit(tx, {
      actor: actorOf(user),
      action: input.featured ? "portfolio.featured" : "portfolio.unfeatured",
      entity: { type: "portfolio_item", id: input.itemId },
      scope: `executor:${item.executorId}`,
    });
  });
}
