import { describe, expect, it } from "vitest";
import { db, transaction } from "@/platform/db";
import { makeExecutor } from "../../../test/factories";
import { makeFurnitureType, makeOfferThread, makeReview } from "../../../test/factories/companies";
import { publicExecutorView, publicExecutorViews, recalculateRating } from "./index";

const ALLOWED_KEYS = [
  "id",
  "publicNumber",
  "label",
  "segment",
  "ratingAvg",
  "reviewsCount",
  "completedDeals",
  "yearsExperience",
  "measurementTerms",
  "measurementFee",
  "specializations",
].sort();

describe("publicExecutorView", () => {
  it("показывает «Исполнитель №N», сегмент, опыт, условия замера и специализации", async () => {
    const executor = await makeExecutor({ segment: "PREMIUM" });
    const kitchen = await makeFurnitureType({ slug: "kitchen", name: "Кухня" });
    await db.executorProfile.update({
      where: { id: executor.executor.id },
      data: {
        yearsExperience: 7,
        measurementTerms: "FEE_IF_NO_DEAL",
        measurementFee: 10_000,
        specializations: { connect: { id: kitchen.id } },
      },
    });

    const view = await publicExecutorView(executor.executor.id);

    expect(view).toEqual({
      id: executor.executor.id,
      publicNumber: executor.executor.publicNumber,
      label: `Исполнитель №${executor.executor.publicNumber}`,
      segment: "PREMIUM",
      ratingAvg: 0,
      reviewsCount: 0,
      completedDeals: 0,
      yearsExperience: 7,
      measurementTerms: "FEE_IF_NO_DEAL",
      measurementFee: 10_000,
      specializations: [{ slug: "kitchen", name: "Кухня" }],
    });
  });

  it("не раскрывает наименование, ФИО, телефон и ИИН/БИН", async () => {
    const executor = await makeExecutor({ legalName: "ТОО «Секретная Мебель»" });
    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id }, include: { user: true } });

    const view = await publicExecutorView(executor.executor.id);
    const json = JSON.stringify(view);

    expect(Object.keys(view).sort()).toEqual(ALLOWED_KEYS);
    expect(json).not.toContain("Секретная Мебель");
    expect(json).not.toContain(profile.user.phone);
    expect(json).not.toContain(profile.user.phone.slice(2));
    expect(json).not.toContain(profile.binIinLast4);
    expect(json).not.toContain(profile.binIinEnc);
    expect(json).not.toContain(profile.userId);
    expect(json).not.toContain(profile.user.fullName!);
  });

  it("неизвестный исполнитель — NOT_FOUND", async () => {
    await expect(publicExecutorView("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("пакетно: представления по списку id одним запросом", async () => {
    const a = await makeExecutor();
    const b = await makeExecutor();
    const views = await publicExecutorViews([a.executor.id, b.executor.id, a.executor.id]);
    expect(views.size).toBe(2);
    expect(views.get(b.executor.id)?.label).toBe(`Исполнитель №${b.executor.publicNumber}`);
  });
});

describe("recalculateRating", () => {
  it("считает средний рейтинг, число отзывов и завершённых сделок", async () => {
    const executor = await makeExecutor();
    await makeReview(executor, 5);
    await makeReview(executor, 4);
    await makeReview(executor, 4);
    await makeOfferThread({ executor, dealStatus: "IN_PROGRESS" });

    await transaction((tx) => recalculateRating(tx, executor.executor.id));

    const view = await publicExecutorView(executor.executor.id);
    expect(view).toMatchObject({ ratingAvg: 4.33, reviewsCount: 3, completedDeals: 3 });
  });

  it("без отзывов — ноль; повторный вызов даёт тот же результат", async () => {
    const executor = await makeExecutor();
    await transaction((tx) => recalculateRating(tx, executor.executor.id));
    await transaction((tx) => recalculateRating(tx, executor.executor.id));
    expect(await publicExecutorView(executor.executor.id)).toMatchObject({ ratingAvg: 0, reviewsCount: 0, completedDeals: 0 });
  });

  it("параллельные отзывы не теряются", async () => {
    const executor = await makeExecutor();
    const [a, b] = await Promise.all([makeOfferThread({ executor, dealStatus: "COMPLETED" }), makeOfferThread({ executor, dealStatus: "COMPLETED" })]);

    await Promise.all(
      [
        [a, 5],
        [b, 3],
      ].map(([thread, rating]) =>
        transaction(async (tx) => {
          const t = thread as typeof a;
          await tx.review.create({ data: { dealId: t.dealId!, executorId: executor.executor.id, authorId: t.client.id, rating: rating as number } });
          await recalculateRating(tx, executor.executor.id);
        }),
      ),
    );

    expect(await publicExecutorView(executor.executor.id)).toMatchObject({ ratingAvg: 4, reviewsCount: 2, completedDeals: 2 });
  });
});
