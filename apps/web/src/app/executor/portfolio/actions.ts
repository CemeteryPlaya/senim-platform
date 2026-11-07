"use server";

import { z } from "zod";
import {
  attachPortfolioPhotos,
  createPortfolioFromDeal,
  createPortfolioItem,
  fromDealInputSchema,
  deletePortfolioItem,
  PORTFOLIO_MAX_PHOTOS,
  portfolioInputSchema,
  removePortfolioPhoto,
  setPortfolioPublished,
  updatePortfolioItem,
} from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Владение работой проверяет companies: чужая работа — NOT_FOUND.
const id = z.string().min(1).max(64);

export const createWork = action("companies.createPortfolioItem", portfolioInputSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  return createPortfolioItem(user, input);
});

export const updateWork = action("companies.updatePortfolioItem", portfolioInputSchema.extend({ id }), async ({ id: itemId, ...input }) => {
  const user = await requireUser("EXECUTOR");
  return updatePortfolioItem(user, itemId, input);
});

export const setWorkPublished = action("companies.setPortfolioPublished", z.object({ id, published: z.boolean() }), async (input) => {
  const user = await requireUser("EXECUTOR");
  await setPortfolioPublished(user, input.id, input.published);
  return null;
});

export const deleteWork = action("companies.deletePortfolioItem", z.object({ id }), async (input) => {
  const user = await requireUser("EXECUTOR");
  await deletePortfolioItem(user, input.id);
  return null;
});

export const removeWorkPhoto = action("companies.removePortfolioPhoto", z.object({ id, fileId: id }), async (input) => {
  const user = await requireUser("EXECUTOR");
  await removePortfolioPhoto(user, input.id, input.fileId);
  return null;
});

/** Для uploader (platform-engineer): после загрузки файлов с purpose PORTFOLIO привязать их к работе. */
export const attachWorkPhotos = action(
  "companies.attachPortfolioPhotos",
  z.object({ id, fileIds: z.array(id).min(1).max(PORTFOLIO_MAX_PHOTOS) }),
  async (input) => {
    const user = await requireUser("EXECUTOR");
    await attachPortfolioPhotos(user, input.id, input.fileIds);
    return null;
  },
);

/** «Добавить в портфолио» из завершённой сделки: сделку, фото и повтор проверяет companies. */
export const createWorkFromDeal = action("companies.createPortfolioFromDeal", fromDealInputSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  return createPortfolioFromDeal(user, input);
});
