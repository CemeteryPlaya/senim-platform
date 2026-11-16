import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeExecutor } from "../../../test/factories";
import { makeFurnitureType, makePortfolioItem, makeReview } from "../../../test/factories/companies";
import { EXECUTOR_IDENTITY_KEY } from "./identity-mode";
import { CATALOG_PAGE_SIZE, getInspirationItem, listInspiration, getPortfolioForRequest, getPublicExecutorPage, listCatalog, MASK } from "./index";

describe("каталог работ", () => {
  it("показывает только опубликованные работы подтверждённых исполнителей по включённым типам", async () => {
    const approved = await makeExecutor();
    const pending = await makeExecutor({ status: "PENDING" });
    const offType = await makeFurnitureType({ active: false });
    const visible = await makePortfolioItem(approved, { title: "Видна" });
    await makePortfolioItem(approved, { title: "Черновик", published: false });
    await makePortfolioItem(pending, { title: "Не подтверждён" });
    await makePortfolioItem(approved, { title: "Тип выключен", furnitureTypeId: offType.id });

    const { items, total } = await listCatalog({ page: 1 });
    expect(total).toBe(1);
    expect(items.map((i) => i.id)).toEqual([visible.id]);
  });

  it("карточка: работа, тип, стиль, цена, фото и анонимный исполнитель", async () => {
    const executor = await makeExecutor({ segment: "PREMIUM", legalName: "ТОО «Тайное имя»" });
    const kitchen = await makeFurnitureType({ slug: "kitchen", name: "Кухня" });
    const item = await makePortfolioItem(executor, { furnitureTypeId: kitchen.id, style: "loft", title: "Кухня в лофте", priceFrom: 1_200_000 });

    const [card] = (await listCatalog({ page: 1 })).items;
    expect(card).toMatchObject({
      id: item.id,
      title: "Кухня в лофте",
      furnitureType: { slug: "kitchen", name: "Кухня" },
      style: { key: "loft", name: "Лофт" },
      priceFrom: 1_200_000,
      executor: { id: executor.executor.id, label: `Исполнитель №${executor.executor.publicNumber}`, segment: "PREMIUM" },
    });
    expect(card.photos[0].src).toMatch(/^\/demo\/portfolio\/.+\.svg$/);
    expect(JSON.stringify(card)).not.toContain("Тайное имя");
  });

  it("фильтры: тип, стиль, сегмент, цена", async () => {
    const comfort = await makeExecutor({ segment: "COMFORT" });
    const premium = await makeExecutor({ segment: "PREMIUM" });
    const kitchen = await makeFurnitureType({ slug: "kitchen" });
    const wardrobe = await makeFurnitureType({ slug: "wardrobe" });
    const a = await makePortfolioItem(comfort, { furnitureTypeId: kitchen.id, style: "scandi", priceFrom: 250_000 });
    const b = await makePortfolioItem(premium, { furnitureTypeId: kitchen.id, style: "loft", priceFrom: 2_000_000 });
    const c = await makePortfolioItem(comfort, { furnitureTypeId: wardrobe.id, style: "loft", priceFrom: 500_000 });
    await makePortfolioItem(comfort, { furnitureTypeId: wardrobe.id, style: "modern", priceFrom: null });

    const ids = async (f: Parameters<typeof listCatalog>[0]) => (await listCatalog(f)).items.map((i) => i.id).sort();
    expect(await ids({ page: 1, type: "kitchen" })).toEqual([a.id, b.id].sort());
    expect(await ids({ page: 1, style: "loft" })).toEqual([b.id, c.id].sort());
    expect(await ids({ page: 1, segment: "PREMIUM" })).toEqual([b.id]);
    expect(await ids({ page: 1, price: "upto300" })).toEqual([a.id]);
    expect(await ids({ page: 1, price: "300-700" })).toEqual([c.id]);
    expect(await ids({ page: 1, price: "from1500" })).toEqual([b.id]);
    expect(await ids({ page: 1, type: "wardrobe", style: "loft", segment: "COMFORT", price: "300-700" })).toEqual([c.id]);
  });

  it("постранично, новые сверху", async () => {
    const executor = await makeExecutor();
    const type = await makeFurnitureType();
    for (let i = 0; i < CATALOG_PAGE_SIZE + 2; i++) await makePortfolioItem(executor, { furnitureTypeId: type.id, title: `Работа ${i}` });

    const first = await listCatalog({ page: 1 });
    const second = await listCatalog({ page: 2 });
    expect(first).toMatchObject({ total: CATALOG_PAGE_SIZE + 2, page: 1, pageCount: 2 });
    expect(first.items).toHaveLength(CATALOG_PAGE_SIZE);
    expect(second.items).toHaveLength(2);
    expect(first.items[0].title).toBe(`Работа ${CATALOG_PAGE_SIZE + 1}`);
  });
});

describe("публичная страница исполнителя", () => {
  it("анонимно: «о себе» без контактов и наименования, отзывы, только опубликованные работы", async () => {
    const executor = await makeExecutor({ legalName: "ТОО «Ағаш Шебер»" });
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { about: "Ағаш Шебер — кухни. Тел. 87001234567" } });
    const shown = await makePortfolioItem(executor);
    await makePortfolioItem(executor, { published: false });
    await makeReview(executor, 5, "Отлично! Мастер оставил номер 8 700 765 43 21");

    const page = await getPublicExecutorPage(executor.executor.publicNumber);
    expect(page).not.toBeNull();
    expect(page!.view.label).toBe(`Исполнитель №${executor.executor.publicNumber}`);
    expect(page!.about).toBe(`${MASK} — кухни. Тел. ${MASK}`);
    expect(page!.portfolio.map((p) => p.id)).toEqual([shown.id]);
    expect(page!.reviews).toHaveLength(1);
    expect(page!.reviews[0]).toMatchObject({ rating: 5, text: `Отлично! Мастер оставил номер ${MASK}` });
    expect(JSON.stringify(page)).not.toMatch(/Ағаш Шебер|87001234567/);
  });

  it("наименование мастера из текста отзыва маскируется (как «о себе») — в HIDDEN и в SHOWN", async () => {
    const executor = await makeExecutor({ legalName: "ТОО «Ағаш Шебер»" });
    await makeReview(executor, 5, "Спасибо, Ағаш Шебер, всё сделали вовремя");

    const hidden = await getPublicExecutorPage(executor.executor.publicNumber);
    expect(hidden!.reviews[0]!.text).toBe(`Спасибо, ${MASK}, всё сделали вовремя`);
    expect(JSON.stringify(hidden)).not.toContain("Ағаш Шебер");

    await db.platformSetting.create({ data: { key: EXECUTOR_IDENTITY_KEY, value: "SHOWN" } });
    const shown = await getPublicExecutorPage(executor.executor.publicNumber);
    expect(shown!.view.label).toBe("ТОО «Ағаш Шебер»");
    // Текст отзыва остаётся очищенным: показ имени платформой не отменяет маску в текстах мастера и заказчика.
    expect(shown!.reviews[0]!.text).toBe(`Спасибо, ${MASK}, всё сделали вовремя`);
  });

  it("«Вдохновение»: наименование мастера в отзыве по сделке работы маскируется — в HIDDEN и в SHOWN", async () => {
    const executor = await makeExecutor({ legalName: "ТОО «Ағаш Шебер»" });
    const review = await makeReview(executor, 5, "Спасибо, Ағаш Шебер! Звоните 87001234567");
    const item = await makePortfolioItem(executor, { title: "Кухня" });
    await db.portfolioItem.update({ where: { id: item.id }, data: { dealId: review.dealId } });
    await db.deal.update({ where: { id: review.dealId }, data: { portfolioConsentAt: new Date() } });
    const expected = `Спасибо, ${MASK}! Звоните ${MASK}`;

    expect((await getInspirationItem(item.id, null))!.review!.text).toBe(expected);

    await db.platformSetting.create({ data: { key: EXECUTOR_IDENTITY_KEY, value: "SHOWN" } });
    expect((await getInspirationItem(item.id, null))!.review!.text).toBe(expected);
  });

  it("отдельное имя владельца вырезается в «О себе», отзывах и на карточке «Вдохновения» — в HIDDEN и в SHOWN; текст без имени не меняется", async () => {
    const executor = await makeExecutor({ legalName: "ИП Ағаш Шебер" });
    await db.user.update({ where: { id: executor.id }, data: { fullName: "Жумабаев Ерлан" } });
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { signerFullName: "Жумабаев Ерлан Нурланович", about: "Меня зовут Ерлан, делаю кухни" } });
    const review = await makeReview(executor, 5, "Ерлан сделал кухню вовремя");
    const clean = await makeReview(executor, 4, "Всё сделано аккуратно");
    const item = await makePortfolioItem(executor, { title: "Кухня Ерлана", description: "Сделал Ерлан" });
    await db.portfolioItem.update({ where: { id: item.id }, data: { dealId: review.dealId } });
    await db.deal.update({ where: { id: review.dealId }, data: { portfolioConsentAt: new Date() } });

    const check = async () => {
      const page = await getPublicExecutorPage(executor.executor.publicNumber);
      expect(page!.about).toBe(`Меня зовут ${MASK}, делаю кухни`);
      const texts = page!.reviews.map((r) => r.text).sort();
      expect(texts).toEqual([`${MASK} сделал кухню вовремя`, "Всё сделано аккуратно"].sort());
      expect(page!.portfolio[0]).toMatchObject({ title: `Кухня ${MASK}`, description: `Сделал ${MASK}` });
      const card = await getInspirationItem(item.id, null);
      expect(card!.review!.text).toBe(`${MASK} сделал кухню вовремя`);
      expect(card!.title).toBe(`Кухня ${MASK}`);
      const feed = await listInspiration({ limit: 12 });
      expect(feed.items[0]!.title).toBe(`Кухня ${MASK}`);
      // Поля для маски наружу не уходят.
      expect(JSON.stringify([page, card, feed])).not.toMatch(/Ерлан|Жумабаев|signerFullName|legalForm/);
    };
    await check();

    await db.platformSetting.create({ data: { key: EXECUTOR_IDENTITY_KEY, value: "SHOWN" } });
    await check();
    expect(clean.id).toBeTruthy();
  });

  it("неподтверждённый или неизвестный исполнитель — null", async () => {
    const pending = await makeExecutor({ status: "PENDING" });
    expect(await getPublicExecutorPage(pending.executor.publicNumber)).toBeNull();
    expect(await getPublicExecutorPage(999_999)).toBeNull();
  });
});

describe("«Хочу похожее»: работа для прямой заявки", () => {
  it("видимая работа — с типом, стилем и анонимным исполнителем", async () => {
    const executor = await makeExecutor();
    const kitchen = await makeFurnitureType({ slug: "kitchen", name: "Кухня" });
    const item = await makePortfolioItem(executor, { furnitureTypeId: kitchen.id, style: "scandi" });

    expect(await getPortfolioForRequest(item.id)).toMatchObject({
      id: item.id,
      furnitureTypeId: kitchen.id,
      furnitureType: { slug: "kitchen", name: "Кухня" },
      style: { key: "scandi" },
      executor: { id: executor.executor.id, label: `Исполнитель №${executor.executor.publicNumber}` },
    });
  });

  it("снятая с публикации или чужая неизвестная — null", async () => {
    const executor = await makeExecutor();
    const hidden = await makePortfolioItem(executor, { published: false });
    expect(await getPortfolioForRequest(hidden.id)).toBeNull();
    expect(await getPortfolioForRequest("nope")).toBeNull();
  });
});
