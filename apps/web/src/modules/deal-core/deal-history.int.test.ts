import { describe, expect, it } from "vitest";
import type { DealStatus, ShowcaseAddress, ShowcaseSignature } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { MASK } from "@/modules/companies";
import { db, transaction } from "@/platform/db";
import { makeExecutor } from "../../../test/factories";
import { makeDealWithReport, makeOfferThread, PRICE_TIYN } from "../../../test/factories/companies";
import type { Executor } from "../../../test/factories/deal";
import { closeShowcasesOf, listExecutorDealHistory, type DealHistoryItem } from "./index";

const FULL_NAME = "Сапарова Айгерим Маратовна";
const STREET = "ул. Тестовая, 1, кв. 2"; // Request.address из makeDealWithReport: на странице мастера — никогда

type Showcase = { photos?: boolean; price?: boolean; address?: ShowcaseAddress; signature?: ShowcaseSignature; signedAs: string };

/**
 * Оконченная сделка мастера с офертой: фото сдачи (2 DELIVERY) и фото «Хода работ», заявка в Астане с улицей,
 * районом и ЖК; время окончания — completedAt (успешно) или cancelledAt (отмена, возврат).
 */
async function endedDeal(
  executor: Executor,
  opts: {
    status?: DealStatus;
    endedAt?: Date;
    review?: { rating: number; text: string } | null;
    fullName?: string | null;
    district?: string | null;
    complex?: string | null;
    showcase?: Showcase;
  } = {},
) {
  const status = opts.status ?? "SPLIT_PAYOUT";
  const d = await makeDealWithReport({ executor, dealStatus: status });
  const endedAt = opts.endedAt ?? new Date();
  await db.deal.update({ where: { id: d.dealId }, data: status === "SPLIT_PAYOUT" ? { completedAt: endedAt } : { cancelledAt: endedAt } });
  await db.user.update({ where: { id: d.client.id }, data: { fullName: opts.fullName === undefined ? FULL_NAME : opts.fullName } });
  await db.request.update({
    where: { id: d.requestId },
    data: { district: opts.district === undefined ? "Есиль" : opts.district, complex: opts.complex === undefined ? "Хайвил" : opts.complex },
  });
  const review = opts.review === undefined ? { rating: 5, text: "Отличная кухня" } : opts.review;
  const created = review
    ? await db.review.create({ data: { dealId: d.dealId, executorId: executor.executor.id, authorId: d.client.id, ...review } })
    : null;
  if (opts.showcase) await db.dealShowcase.create({ data: { dealId: d.dealId, textVersion: "test", updatedById: d.client.id, ...opts.showcase } });
  return { ...d, endedAt, reviewCreatedAt: created?.createdAt ?? null };
}

/** Весь ответ строкой (bigint — как текст): проверка, что чего-то в нём нет вовсе. */
const dump = (items: DealHistoryItem[]) => JSON.stringify(items, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

describe("сделки мастера на площадке для публичной страницы", () => {
  it("без выбора покупателя — нет фото, стоимости и места, подпись — инициал автора отзыва", async () => {
    const executor = await makeExecutor();
    const d = await endedDeal(executor);

    expect(await listExecutorDealHistory(executor.executor.id)).toEqual([
      {
        id: d.dealId,
        title: "Кухня",
        segment: "COMFORT",
        endedAt: d.endedAt,
        outcome: "success",
        photos: [],
        priceTiyn: null,
        place: null,
        review: { rating: 5, text: "Отличная кухня", signedAs: "А.", createdAt: d.reviewCreatedAt },
      },
    ]);
  });

  it("после отзыва согласия на ПДн — так же, как без выбора", async () => {
    const executor = await makeExecutor();
    const d = await endedDeal(executor, { showcase: { photos: true, price: true, address: "COMPLEX", signature: "NAME", signedAs: "Айгерим" } });
    await transaction((tx) => closeShowcasesOf(tx, d.client.id));

    const [item] = await listExecutorDealHistory(executor.executor.id);
    expect(item).toMatchObject({ photos: [], priceTiyn: null, place: null, review: { signedAs: "А." } });
    expect(dump([item!])).not.toContain("Айгерим");
  });

  it("выбор «фото, цена, город + район + ЖК, имя» — всё есть; фото — только сдачи, превью, одна ссылка на час", async () => {
    const executor = await makeExecutor();
    const d = await endedDeal(executor, { showcase: { photos: true, price: true, address: "COMPLEX", signature: "NAME", signedAs: "Айгерим" } });
    const previewKey = `delivery/test/${d.finalPhotoIds[0]}.preview.jpg`;
    await db.storedFile.update({ where: { id: d.finalPhotoIds[0] }, data: { previewKey } });
    const original = await db.storedFile.findUniqueOrThrow({ where: { id: d.finalPhotoIds[1] } });

    const before = Math.floor(Date.now() / 1000);
    const [item] = await listExecutorDealHistory(executor.executor.id);
    const after = Math.floor(Date.now() / 1000);

    expect(item).toMatchObject({
      priceTiyn: PRICE_TIYN,
      place: "Астана, Есиль, Хайвил",
      review: { rating: 5, text: "Отличная кухня", signedAs: "Айгерим" },
    });
    expect(item!.photos.map((p) => p.id)).toEqual(d.finalPhotoIds);
    expect(item!.photos.map((p) => p.alt)).toEqual([ru.companies.photoAlt("Кухня", 1), ru.companies.photoAlt("Кухня", 2)]);
    for (const photo of item!.photos) expect(Object.keys(photo).sort()).toEqual(["alt", "id", "src"]);
    const urls = item!.photos.map((p) => new URL(p.src, "http://localhost"));
    // Превью есть — ссылка на превью, нет — на исходник; фото «Хода работ» не показывается.
    expect(urls.map((u) => u.pathname)).toEqual([`/api/files/${previewKey}`, `/api/files/${original.storageKey}`]);
    expect(dump([item!])).not.toContain(d.earlierPhotoId);
    for (const u of urls) {
      const exp = Number(u.searchParams.get("exp"));
      expect(exp).toBeGreaterThanOrEqual(before + 3600);
      expect(exp).toBeLessThanOrEqual(after + 3600);
    }
  });

  it("место — только город / район / ЖК по выбору: улица и дом никогда; нет данных — уровень ниже, ЖК без района — нет", async () => {
    const cases: { address: ShowcaseAddress; district: string | null; complex: string | null; place: string | null }[] = [
      { address: "NONE", district: "Есиль", complex: "Хайвил", place: null },
      { address: "CITY", district: "Есиль", complex: "Хайвил", place: "Астана" },
      { address: "DISTRICT", district: "Есиль", complex: "Хайвил", place: "Астана, Есиль" },
      { address: "COMPLEX", district: "Есиль", complex: null, place: "Астана, Есиль" },
      { address: "DISTRICT", district: null, complex: null, place: "Астана" },
      { address: "COMPLEX", district: null, complex: "Хайвил", place: "Астана" },
      { address: "COMPLEX", district: "  ", complex: "Хайвил", place: "Астана" },
    ];
    for (const c of cases) {
      const executor = await makeExecutor();
      await endedDeal(executor, { district: c.district, complex: c.complex, showcase: { photos: true, price: true, address: c.address, signature: "NAME", signedAs: "Айгерим" } });
      const items = await listExecutorDealHistory(executor.executor.id);
      expect(items.map((i) => i.place), JSON.stringify(c)).toEqual([c.place]);
      expect(dump(items)).not.toContain("Тестовая");
      expect(dump(items)).not.toContain(STREET);
    }
  });

  it("идущая и без оферты — не в списке, чужая — тоже; отмена и возврат — неудачные; новые выше", async () => {
    const executor = await makeExecutor();
    await makeOfferThread({ executor, dealStatus: "IN_PROGRESS" });
    await makeOfferThread({ executor, dealStatus: "CANCELLED", signed: false });
    await endedDeal(await makeExecutor());
    const success = await endedDeal(executor, { endedAt: new Date("2026-10-01T10:00:00Z") });
    const cancelled = await endedDeal(executor, { status: "CANCELLED", endedAt: new Date("2026-11-01T10:00:00Z"), review: null });
    // Сделка без времени перехода (старые данные) — по updatedAt.
    const refunded = await endedDeal(executor, { status: "REFUNDED", review: null });
    const refundedAt = new Date("2026-10-15T10:00:00Z");
    await db.deal.update({ where: { id: refunded.dealId }, data: { cancelledAt: null, updatedAt: refundedAt } });

    const items = await listExecutorDealHistory(executor.executor.id);
    expect(items.map((i) => [i.id, i.outcome, i.endedAt])).toEqual([
      [cancelled.dealId, "failed", cancelled.endedAt],
      [refunded.dealId, "failed", refundedAt],
      [success.dealId, "success", success.endedAt],
    ]);
  });

  it("отзыв с телефоном — маска; без отзыва — review: null", async () => {
    const executor = await makeExecutor();
    await endedDeal(executor, { review: { rating: 4, text: "Звоните мне: +7 701 123 45 67" }, endedAt: new Date("2026-11-02T10:00:00Z") });
    await endedDeal(executor, { review: null, endedAt: new Date("2026-11-01T10:00:00Z") });

    const [withReview, without] = await listExecutorDealHistory(executor.executor.id);
    expect(withReview!.review!.text).toContain(MASK);
    expect(withReview!.review!.text).not.toMatch(/701|123 45 67/);
    expect(without!.review).toBeNull();
  });

  it("подпись: выбран инициал с пустым снимком — инициал автора; ФИО нет — пусто", async () => {
    const executor = await makeExecutor();
    await endedDeal(executor, { endedAt: new Date("2026-11-02T10:00:00Z"), showcase: { signature: "INITIAL", signedAs: "" } });
    await endedDeal(executor, { endedAt: new Date("2026-11-01T10:00:00Z"), fullName: null });

    const items = await listExecutorDealHistory(executor.executor.id);
    expect(items.map((i) => i.review?.signedAs)).toEqual(["А.", ""]);
  });

  it("мастер не подтверждён или заблокирован — пустой список", async () => {
    const pending = await makeExecutor({ status: "PENDING" });
    await endedDeal(pending);
    expect(await listExecutorDealHistory(pending.executor.id)).toEqual([]);

    const blocked = await makeExecutor();
    await endedDeal(blocked);
    expect(await listExecutorDealHistory(blocked.executor.id)).toHaveLength(1);
    await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
    expect(await listExecutorDealHistory(blocked.executor.id)).toEqual([]);

    expect(await listExecutorDealHistory("нет-такого")).toEqual([]);
  });

  it("лимит: по умолчанию 20, задаётся опцией — самые новые", async () => {
    const executor = await makeExecutor();
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) {
      const t = await makeOfferThread({ executor, dealStatus: "SPLIT_PAYOUT" });
      await db.deal.update({ where: { id: t.dealId! }, data: { completedAt: new Date(Date.UTC(2026, 9, 1 + i)) } });
      ids.push(t.dealId!);
    }
    const newest = [...ids].reverse();

    expect((await listExecutorDealHistory(executor.executor.id)).map((i) => i.id)).toEqual(newest.slice(0, 20));
    expect((await listExecutorDealHistory(executor.executor.id, { limit: 2 })).map((i) => i.id)).toEqual(newest.slice(0, 2));
  });
});
