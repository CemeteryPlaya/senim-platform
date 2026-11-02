import { describe, expect, it } from "vitest";
import { leaveReview } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { actingAs, makeClient, makeExecutor, makeOperator, makeUser } from "../../../test/factories";
import { makeDealWithReport, makePortfolioItem, withFeature } from "../../../test/factories/companies";
import {
  createPortfolioFromDeal,
  deletePortfolioItem,
  findLikeablePortfolioItem,
  getDealPortfolioDraft,
  getDealPortfolioPanel,
  getInspirationItem,
  getPublicExecutorPage,
  listCatalog,
  listInspiration,
  listOwnPortfolio,
  setPortfolioConsent,
  setPortfolioFeatured,
} from "./index";

type Fixture = Awaited<ReturnType<typeof makeDealWithReport>>;

const fromDeal = (d: Fixture, extra: Partial<Parameters<typeof createPortfolioFromDeal>[1]> = {}) =>
  createPortfolioFromDeal(d.executor, {
    dealId: d.dealId,
    fileIds: d.finalPhotoIds,
    furnitureTypeId: d.furnitureTypeId,
    style: "scandi",
    title: "Светлая кухня",
    description: "",
    place: "Астана, Есильский район",
    priceFrom: null,
    published: true,
    ...extra,
  });

const inFeed = async (itemId: string) => (await listInspiration({ limit: 96 })).items.some((i) => i.id === itemId);

describe("портфолио из сделки: добавление исполнителем", () => {
  it("форма подставляет тип, стиль и город из заявки; фото — только фото сдачи", async () => {
    const d = await makeDealWithReport();
    const draft = await getDealPortfolioDraft(d.executor, d.dealId);
    expect(draft).toMatchObject({ furnitureTypeId: d.furnitureTypeId, style: "scandi", place: "Астана", existingItemId: null, consent: false });
    expect(draft.photos.map((p) => p.id)).toEqual(d.finalPhotoIds);
    // Точный адрес заявки в форму не попадает.
    expect(JSON.stringify(draft)).not.toContain("Тестовая");
  });

  it("создаёт работу со ссылкой на сделку и фото сдачи; повтор — та же работа, без второго журнала", async () => {
    const d = await makeDealWithReport();
    const first = await fromDeal(d);
    const again = await fromDeal(d, { title: "Другое название" });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });

    const item = await db.portfolioItem.findUniqueOrThrow({ where: { id: first.id }, include: { dealPhotos: true } });
    expect(item).toMatchObject({ dealId: d.dealId, place: "Астана, Есильский район", title: "Светлая кухня" });
    expect(item.dealPhotos.map((p) => p.fileId).sort()).toEqual([...d.finalPhotoIds].sort());
    expect(await db.auditEvent.count({ where: { entityId: first.id, action: "portfolio.created_from_deal" } })).toBe(1);
  });

  it("двойной клик одновременно — одна работа", async () => {
    const d = await makeDealWithReport();
    const results = await Promise.allSettled([fromDeal(d), fromDeal(d)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await db.portfolioItem.count({ where: { dealId: d.dealId } })).toBe(1);
  });

  it("чужая сделка — не найдено; незавершённая — конфликт", async () => {
    const d = await makeDealWithReport();
    const stranger = await makeExecutor();
    await expect(fromDeal({ ...d, executor: stranger })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDealPortfolioDraft(stranger, d.dealId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const running = await makeDealWithReport({ dealStatus: "IN_PROGRESS" });
    await expect(fromDeal(running)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("фото не из сдачи (ход работ) или чужое — отказ; адрес вместо места — отказ", async () => {
    const d = await makeDealWithReport();
    await expect(fromDeal(d, { fileIds: [d.earlierPhotoId] })).rejects.toMatchObject({ code: "VALIDATION" });
    const other = await makeDealWithReport();
    await expect(fromDeal(d, { fileIds: other.finalPhotoIds })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(fromDeal(d, { place: "ул. Абая 10, кв. 5" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.portfolioItem.count({ where: { dealId: d.dealId } })).toBe(0);
  });

  it("удаление работы не трогает фото сдачи", async () => {
    const d = await makeDealWithReport();
    const { id } = await fromDeal(d);
    await deletePortfolioItem(d.executor, id);
    expect(await db.storedFile.count({ where: { id: { in: d.finalPhotoIds } } })).toBe(d.finalPhotoIds.length);
  });
});

describe("согласие заказчика на показ", () => {
  it("без согласия работа — черновик исполнителя: нет во «Вдохновении», каталоге, на странице и в «Хочу похожее»", async () => {
    const d = await makeDealWithReport();
    const { id } = await fromDeal(d);
    const viewer = await makeClient();

    expect(await inFeed(id)).toBe(false);
    expect((await listCatalog({ page: 1 })).items.map((i) => i.id)).not.toContain(id);
    expect((await getPublicExecutorPage(d.executor.executor.publicNumber))!.portfolio.map((p) => p.id)).not.toContain(id);
    expect(await findLikeablePortfolioItem(db, id, viewer.id)).toBeNull();
    expect(await getInspirationItem(id, viewer)).toBeNull();

    const own = (await listOwnPortfolio(d.executor)).find((i) => i.id === id);
    expect(own).toMatchObject({ fromDeal: { consent: false } });
  });

  it("заказчик разрешает — работа видна с пометкой «Выполнено на Сенім» и местом; отзывает — скрыта", async () => {
    const d = await makeDealWithReport();
    const { id } = await fromDeal(d);

    expect(await setPortfolioConsent(d.client, { dealId: d.dealId, consent: true })).toEqual({ changed: true });
    const tile = (await listInspiration({ limit: 96 })).items.find((i) => i.id === id);
    expect(tile).toMatchObject({ doneOnPlatform: true, place: "Астана, Есильский район" });
    expect(tile!.cover?.id).toBe(d.finalPhotoIds[0]);
    expect((await getPublicExecutorPage(d.executor.executor.publicNumber))!.portfolio.map((p) => p.id)).toContain(id);

    expect(await setPortfolioConsent(d.client, { dealId: d.dealId, consent: false })).toEqual({ changed: true });
    expect(await inFeed(id)).toBe(false);

    const audit = await db.auditEvent.findMany({ where: { scope: `deal:${d.dealId}`, action: { startsWith: "portfolio.consent" } }, orderBy: { seq: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["portfolio.consent_given", "portfolio.consent_revoked"]);
    expect(await db.notification.count({ where: { userId: d.executor.id, kind: { startsWith: "portfolio.consent" } } })).toBe(2);
  });

  it("повтор согласия не меняет дату и не пишет журнал второй раз", async () => {
    const d = await makeDealWithReport();
    await setPortfolioConsent(d.client, { dealId: d.dealId, consent: true });
    const at = (await db.deal.findUniqueOrThrow({ where: { id: d.dealId } })).portfolioConsentAt;
    const twice = await Promise.all([
      setPortfolioConsent(d.client, { dealId: d.dealId, consent: true }),
      setPortfolioConsent(d.client, { dealId: d.dealId, consent: true }),
    ]);
    expect(twice).toEqual([{ changed: false }, { changed: false }]);
    expect((await db.deal.findUniqueOrThrow({ where: { id: d.dealId } })).portfolioConsentAt).toEqual(at);
    expect(await db.auditEvent.count({ where: { scope: `deal:${d.dealId}`, action: "portfolio.consent_given" } })).toBe(1);
  });

  it("согласие можно дать до того, как исполнитель добавил работу", async () => {
    const d = await makeDealWithReport();
    await setPortfolioConsent(d.client, { dealId: d.dealId, consent: true });
    const { id } = await fromDeal(d);
    expect(await inFeed(id)).toBe(true);
  });

  it("чужая сделка — не найдено; исполнитель за заказчика не разрешает; незавершённая — конфликт", async () => {
    const d = await makeDealWithReport();
    await expect(setPortfolioConsent(await makeClient(), { dealId: d.dealId, consent: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setPortfolioConsent(d.executor, { dealId: d.dealId, consent: true })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const running = await makeDealWithReport({ dealStatus: "IN_PROGRESS" });
    await expect(setPortfolioConsent(running.client, { dealId: running.dealId, consent: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.deal.findUniqueOrThrow({ where: { id: running.dealId } })).portfolioConsentAt).toBeNull();
  });

  it("галочка в отзыве даёт согласие в той же транзакции", async () => {
    const d = await makeDealWithReport();
    await withFeature("reviews", true, () => leaveReview(d.client, { dealId: d.dealId, rating: 5, text: "Отлично", portfolioConsent: true }));
    expect((await db.deal.findUniqueOrThrow({ where: { id: d.dealId } })).portfolioConsentAt).not.toBeNull();

    const other = await makeDealWithReport();
    await withFeature("reviews", true, () => leaveReview(other.client, { dealId: other.dealId, rating: 4 }));
    expect((await db.deal.findUniqueOrThrow({ where: { id: other.dealId } })).portfolioConsentAt).toBeNull();
  });

  it("неподтверждённый или заблокированный исполнитель — работы нет в ленте даже при согласии", async () => {
    const d = await makeDealWithReport();
    const { id } = await fromDeal(d);
    await setPortfolioConsent(d.client, { dealId: d.dealId, consent: true });
    expect(await inFeed(id)).toBe(true);

    await db.user.update({ where: { id: d.executor.id }, data: { blockedAt: new Date() } });
    expect(await inFeed(id)).toBe(false);
    await db.user.update({ where: { id: d.executor.id }, data: { blockedAt: null } });
    await db.executorProfile.update({ where: { id: d.executor.executor.id }, data: { status: "PENDING" } });
    expect(await inFeed(id)).toBe(false);
  });
});

describe("блок на экране сделки", () => {
  it("заказчику — согласие, исполнителю — добавленная работа, постороннему и до завершения — ничего", async () => {
    const d = await makeDealWithReport();
    expect(await getDealPortfolioPanel(d.client, d.dealId)).toEqual({ viewer: "CLIENT", consent: false });
    expect(await getDealPortfolioPanel(d.executor, d.dealId)).toEqual({ viewer: "EXECUTOR", consent: false, itemId: null, photos: 2 });

    const { id } = await fromDeal(d);
    await setPortfolioConsent(d.client, { dealId: d.dealId, consent: true });
    expect(await getDealPortfolioPanel(d.executor, d.dealId)).toEqual({ viewer: "EXECUTOR", consent: true, itemId: id, photos: 2 });

    expect(await getDealPortfolioPanel(await makeClient(), d.dealId)).toBeNull();
    expect(await getDealPortfolioPanel(await makeOperator(), d.dealId)).toBeNull();
    const running = await makeDealWithReport({ dealStatus: "IN_PROGRESS" });
    expect(await getDealPortfolioPanel(running.client, running.dealId)).toBeNull();
  });
});

describe("«Вдохновение»: подборка и карточка", () => {
  it("подборку ведёт только оператор; отмеченные — первыми; повтор не пишет журнал", async () => {
    const executor = await makeExecutor();
    const older = await makePortfolioItem(executor, { title: "Старая работа" });
    const newer = await makePortfolioItem(executor, { title: "Новая работа" });
    await db.portfolioItem.update({ where: { id: older.id }, data: { createdAt: new Date(Date.now() - 86_400_000) } });

    await expect(setPortfolioFeatured(await makeClient(), { itemId: older.id, featured: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setPortfolioFeatured(executor, { itemId: older.id, featured: true })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const operator = await makeOperator();
    await setPortfolioFeatured(operator, { itemId: older.id, featured: true });
    await setPortfolioFeatured(operator, { itemId: older.id, featured: true });
    expect(await db.auditEvent.count({ where: { entityId: older.id, action: "portfolio.featured" } })).toBe(1);

    const { items } = await listInspiration({ limit: 12 });
    expect(items.map((i) => i.id)).toEqual([older.id, newer.id]);
    expect(items[0]).toMatchObject({ featured: true });
  });

  it("фильтры по типу и стилю, «Показать ещё» — по порциям", async () => {
    const executor = await makeExecutor();
    const kitchen = await makePortfolioItem(executor, { style: "loft" });
    await makePortfolioItem(executor, { style: "scandi" });
    const type = await db.furnitureType.findUniqueOrThrow({ where: { id: kitchen.furnitureTypeId } });

    expect((await listInspiration({ type: type.slug, limit: 12 })).items.map((i) => i.id)).toEqual([kitchen.id]);
    expect((await listInspiration({ style: "loft", limit: 12 })).items.map((i) => i.id)).toEqual([kitchen.id]);
    const page = await listInspiration({ limit: 1 });
    expect(page).toMatchObject({ hasMore: true });
    expect(page.items).toHaveLength(1);
  });

  it("карточка: исполнитель подписью режима показа, без телефона и наименования; своя работа — без «Хочу похожее»", async () => {
    const executor = await makeExecutor({ legalName: "ИП Секретов Секрет", roles: ["EXECUTOR", "CLIENT"] });
    const item = await makePortfolioItem(executor, { title: "Шкаф" });
    const guest = await getInspirationItem(item.id, null);
    expect(guest).toMatchObject({ canLike: true, own: false, executor: { label: `Исполнитель №${executor.executor.publicNumber}` } });
    const text = JSON.stringify(guest);
    expect(text).not.toContain("Секрет");
    expect(text).not.toContain(executor.phone);

    expect(await getInspirationItem(item.id, actingAs(executor, "CLIENT"))).toMatchObject({ own: true, canLike: false });
    expect(await getInspirationItem(item.id, await makeUser("OPERATOR"))).toMatchObject({ canFeature: true, canLike: false });
  });

  it("у работы из сделки — отзыв заказчика без контактов", async () => {
    const d = await makeDealWithReport();
    const { id } = await fromDeal(d);
    await withFeature("reviews", true, () => leaveReview(d.client, { dealId: d.dealId, rating: 5, text: "Звоните мастеру +7 701 123 45 67", portfolioConsent: true }));
    const detail = await getInspirationItem(id, null);
    expect(detail).toMatchObject({ doneOnPlatform: true, review: { rating: 5 } });
    expect(detail!.review!.text).not.toContain("701");
  });
});
