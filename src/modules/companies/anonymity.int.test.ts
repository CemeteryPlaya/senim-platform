import { afterEach, describe, expect, it } from "vitest";
import { db, transaction } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeExecutor } from "../../../test/factories";
import { makeFurnitureType, makeOfferThread, makeReview } from "../../../test/factories/companies";
import { executorDisplayOf, executorDisplays, publicExecutorView, publicExecutorViews, recalculateRating } from "./index";
import { EXECUTOR_IDENTITY_KEY } from "./identity-mode";

/** Режим «имя показано» (№6): настройка оператора действует только в DEMO_MODE. */
async function showNames() {
  process.env.DEMO_MODE = "true";
  resetEnvCache();
  await db.platformSetting.create({ data: { key: EXECUTOR_IDENTITY_KEY, value: "SHOWN" } });
}

afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

/** Исполнитель с адресом мастерской, телефоном и ИИН/БИН — всё, что не должно утечь в режиме HIDDEN. */
async function makeAddressedExecutor() {
  const executor = await makeExecutor({ legalName: "ТОО «Секретная Мебель»" });
  await db.executorProfile.update({
    where: { id: executor.executor.id },
    data: { city: "Астана", district: "Есильский район", streetAddress: "ул. Потайная, 7" },
  });
  const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id }, include: { user: true } });
  return { executor, profile };
}

const ALLOWED_KEYS = [
  "id",
  "publicNumber",
  "label",
  "labelGen",
  "labelDat",
  "address",
  "nameShown",
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
      labelGen: `Исполнителя №${executor.executor.publicNumber}`,
      labelDat: `Исполнителю №${executor.executor.publicNumber}`,
      address: "Астана",
      nameShown: false,
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

  it("не раскрывает наименование, улицу, ФИО, телефон и ИИН/БИН", async () => {
    const { executor, profile } = await makeAddressedExecutor();

    const view = await publicExecutorView(executor.executor.id);
    const json = JSON.stringify(view);

    expect(Object.keys(view).sort()).toEqual(ALLOWED_KEYS);
    expect(view.address).toBe("Астана, Есильский район");
    expect(json).not.toContain("Секретная Мебель");
    expect(json).not.toContain("Потайная");
    expect(json).not.toContain(profile.user.phone);
    expect(json).not.toContain(profile.user.phone.slice(2));
    expect(json).not.toContain(profile.binIinLast4);
    expect(json).not.toContain(profile.binIinEnc);
    expect(json).not.toContain(profile.userId);
    expect(json).not.toContain(profile.user.fullName!);
  });

  it("режим «имя показано»: наименование и полный адрес; телефон, ФИО владельца и ИИН/БИН — нет", async () => {
    const { executor, profile } = await makeAddressedExecutor();
    await showNames();

    const view = await publicExecutorView(executor.executor.id);
    const json = JSON.stringify(view);

    expect(Object.keys(view).sort()).toEqual(ALLOWED_KEYS);
    expect(view).toMatchObject({
      label: "ТОО «Секретная Мебель»",
      labelGen: "ТОО «Секретная Мебель»",
      address: "Астана, Есильский район, ул. Потайная, 7",
      nameShown: true,
    });
    expect(json).not.toContain(profile.user.phone);
    expect(json).not.toContain(profile.user.phone.slice(2));
    expect(json).not.toContain(profile.binIinLast4);
    expect(json).not.toContain(profile.binIinEnc);
    expect(json).not.toContain(profile.user.fullName!);
  });

  it("executorDisplays: одно решение для всех экранов, по режиму", async () => {
    const { executor } = await makeAddressedExecutor();
    const id = executor.executor.id;

    const hidden = await executorDisplayOf(db, id);
    expect(hidden).toMatchObject({ label: `Исполнитель №${executor.executor.publicNumber}`, address: "Астана, Есильский район" });
    expect(JSON.stringify(hidden)).not.toContain("Потайная");

    await showNames();
    const shown = await executorDisplays(db, [id, id]);
    expect(shown.size).toBe(1);
    expect(shown.get(id)).toMatchObject({ label: "ТОО «Секретная Мебель»", address: "Астана, Есильский район, ул. Потайная, 7" });
  });

  it("неизвестный исполнитель — NOT_FOUND", async () => {
    await expect(publicExecutorView("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(executorDisplayOf(db, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
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
