import { describe, expect, it } from "vitest";
import type { DealStatus } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import { makeExecutor, makeOperator } from "../../../test/factories";
import { makeDealWithReport, makePortfolioItem } from "../../../test/factories/companies";
import { makeDeal, type Executor } from "../../../test/factories/deal";
import { listExecutors, setExecutorIdentityMode, setHighlights } from "./index";

/** Рейтинг и число отзывов — как их хранит профиль (пересчёт отзывов здесь не проверяется). */
async function rated(executor: Executor, ratingAvg: number, reviewsCount: number) {
  await db.executorProfile.update({ where: { id: executor.executor.id }, data: { ratingAvg, reviewsCount } });
  return executor;
}

/** Сделка мастера в статусе; оферта заключена (signedAt), если не сказано иное. */
async function dealOf(executor: Executor, status: DealStatus, signed = true) {
  const f = await makeDeal({ executor });
  await db.deal.update({ where: { id: f.dealId }, data: { status, signedAt: signed ? new Date() : null } });
}

const numbers = (items: { publicNumber: number }[]) => items.map((i) => i.publicNumber);

describe("общий список мастеров", () => {
  it("порядок: с отзывами выше, затем рейтинг, затем успешные сделки, затем публичный номер — и через границу страницы", async () => {
    const noReviewsLate = await makeExecutor();
    const noReviewsEarly = await makeExecutor();
    const fewSuccess = await rated(await makeExecutor(), 4.5, 5);
    const best = await rated(await makeExecutor(), 4.9, 2);
    const moreSuccess = await rated(await makeExecutor(), 4.5, 3);
    const noReviewsOneSuccess = await makeExecutor();
    await dealOf(moreSuccess, "SPLIT_PAYOUT");
    await dealOf(moreSuccess, "SPLIT_PAYOUT");
    await dealOf(fewSuccess, "SPLIT_PAYOUT");
    // Не считаются: идущая, отмена, успешная без оферты.
    await dealOf(fewSuccess, "IN_PROGRESS");
    await dealOf(fewSuccess, "CANCELLED");
    await dealOf(fewSuccess, "SPLIT_PAYOUT", false);
    await dealOf(fewSuccess, "SPLIT_PAYOUT", false);
    await dealOf(noReviewsOneSuccess, "SPLIT_PAYOUT");

    const [early, late] = [noReviewsEarly, noReviewsLate].sort((a, b) => a.executor.publicNumber - b.executor.publicNumber);
    const expected = [best, moreSuccess, fewSuccess, noReviewsOneSuccess, early, late].map((e) => e.executor.publicNumber);

    const all = await listExecutors({ page: 1 });
    expect(numbers(all.items)).toEqual(expected);
    expect(all.total).toBe(6);

    const pages = await Promise.all([1, 2, 3, 4].map((page) => listExecutors({ page, perPage: 2 })));
    expect(pages.map((p) => numbers(p.items))).toEqual([expected.slice(0, 2), expected.slice(2, 4), expected.slice(4, 6), []]);
    expect(pages.map((p) => p.total)).toEqual([6, 6, 6, 6]);
  });

  it("заблокированный, неодобренный и отклонённый мастер — нет в списке и в total", async () => {
    const visible = await makeExecutor();
    const blocked = await makeExecutor();
    await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
    await makeExecutor({ status: "PENDING" });
    await makeExecutor({ status: "REJECTED" });

    const result = await listExecutors({ page: 1 });
    expect(numbers(result.items)).toEqual([visible.executor.publicNumber]);
    expect(result.total).toBe(1);
  });

  it("карточка: метка по режиму показа имени, ценовая группа, рейтинг, число сделок и доля успешных", async () => {
    const executor = await rated(await makeExecutor({ segment: "PREMIUM", legalName: "ИП Секретный" }), 4.7, 3);
    await dealOf(executor, "SPLIT_PAYOUT");
    await dealOf(executor, "SPLIT_PAYOUT");
    await dealOf(executor, "REFUNDED");
    await dealOf(executor, "IN_PROGRESS");
    await dealOf(executor, "CANCELLED", false);

    const [item] = (await listExecutors({ page: 1 })).items;
    expect(item).toMatchObject({
      publicNumber: executor.executor.publicNumber,
      label: `Исполнитель №${executor.executor.publicNumber}`,
      segment: "PREMIUM",
      ratingAvg: 4.7,
      reviewsCount: 3,
      stats: { deals: 4, ended: 3, successful: 2, successRate: 67 },
      cover: null,
    });
    expect(JSON.stringify(item)).not.toContain("Секретный");
    expect(item).not.toHaveProperty("id");

    await setExecutorIdentityMode(await makeOperator(), "SHOWN");
    expect((await listExecutors({ page: 1 })).items[0].label).toBe("ИП Секретный");
  });

  it("обложка: первая лучшая работа с фото; без витрины — последняя опубликованная работа вне площадки с фото", async () => {
    const withHighlights = await makeExecutor();
    const older = await makePortfolioItem(withHighlights, { title: "Шкаф" });
    const chosen = await makePortfolioItem(withHighlights, { title: "Кухня" });
    const noPhoto = await makePortfolioItem(withHighlights, { title: "Без фото", photo: false });
    await setHighlights(withHighlights, { items: [{ kind: "work", id: noPhoto.id }, { kind: "work", id: chosen.id }, { kind: "work", id: older.id }] });

    const worksOnly = await makeExecutor();
    await makePortfolioItem(worksOnly, { title: "Старая" });
    await makePortfolioItem(worksOnly, { title: "Новая" });
    await makePortfolioItem(worksOnly, { title: "Черновик", published: false });
    await makePortfolioItem(worksOnly, { title: "Новейшая без фото", photo: false });

    const fromDeal = await makeExecutor();
    // Работа из сделки — не «вне площадки»: обложкой без витрины не становится.
    const d = await makeDealWithReport({ executor: fromDeal, dealStatus: "SPLIT_PAYOUT" });
    await db.portfolioItem.create({ data: { executorId: fromDeal.executor.id, furnitureTypeId: older.furnitureTypeId, style: "modern", title: "Из сделки", dealId: d.dealId, published: true } });

    const items = new Map((await listExecutors({ page: 1 })).items.map((i) => [i.publicNumber, i]));
    expect(items.get(withHighlights.executor.publicNumber)?.cover?.alt).toContain("Кухня");
    expect(items.get(withHighlights.executor.publicNumber)?.cover?.src).toContain("test-");
    expect(items.get(worksOnly.executor.publicNumber)?.cover?.alt).toContain("Новая");
    expect(items.get(fromDeal.executor.publicNumber)?.cover).toBeNull();
  });

  it("снятая с публикации лучшая работа обложкой не становится", async () => {
    const executor = await makeExecutor();
    const hidden = await makePortfolioItem(executor, { title: "Снятая" });
    const latest = await makePortfolioItem(executor, { title: "Свежая" });
    await setHighlights(executor, { items: [{ kind: "work", id: hidden.id }] });
    await db.portfolioItem.update({ where: { id: hidden.id }, data: { published: false } });

    const [item] = (await listExecutors({ page: 1 })).items;
    expect(item.cover?.alt).toContain(latest.title);
  });
});

