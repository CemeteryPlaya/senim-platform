import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../test/factories";
import {
  makeChosen,
  makeDraft,
  makeExecutorWithTerms,
  makeFurnitureType,
  makeOpenRequest,
  offerInput,
} from "../../../test/factories/requests";
import {
  chooseOffer,
  getIncomingRequest,
  getOfferForClient,
  listIncomingRequests,
  listOffers,
  sendOffer,
  withdrawOffer,
} from "./index";

const code = (code: string) => expect.objectContaining({ code });

describe("видимость заявок исполнителю", () => {
  it("тендер видят подтверждённые исполнители того же сегмента", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
    await makeDraft(client, { segment: "COMFORT" });

    const same = await makeExecutor({ segment: "COMFORT" });
    const other = await makeExecutor({ segment: "PREMIUM" });
    const pending = await makeExecutor({ segment: "COMFORT", status: "PENDING" });
    const rejected = await makeExecutor({ segment: "COMFORT", status: "REJECTED" });

    expect((await listIncomingRequests(same)).map((r) => r.id)).toEqual([requestId]);
    expect(await listIncomingRequests(other)).toEqual([]);
    await expect(listIncomingRequests(pending)).rejects.toThrow(code("FORBIDDEN"));
    await expect(listIncomingRequests(rejected)).rejects.toThrow(code("FORBIDDEN"));
    await expect(getIncomingRequest(other, requestId)).rejects.toThrow(code("NOT_FOUND"));
  });

  it("прямой запрос видит только выбранный исполнитель, даже другого сегмента", async () => {
    const client = await makeClient();
    const target = await makeExecutor({ segment: "PREMIUM" });
    const sameSegment = await makeExecutor({ segment: "COMFORT" });
    const type = await makeFurnitureType();
    const item = await db.portfolioItem.create({ data: { executorId: target.executor.id, furnitureTypeId: type.id, style: "modern", title: "Кухня" } });
    const requestId = await makeOpenRequest(client, { like: item.id, typeId: type.id, segment: "COMFORT" });

    expect((await listIncomingRequests(target)).map((r) => ({ id: r.id, mode: r.mode }))).toEqual([{ id: requestId, mode: "DIRECT" }]);
    expect(await listIncomingRequests(sameSegment)).toEqual([]);
  });

  it("адрес заказчика раскрывается только после выбора отклика этого исполнителя", async () => {
    const client = await makeClient();
    const { requestId, executor } = await makeChosen(client);
    const loser = await makeExecutor({ segment: "COMFORT" });
    const open = await makeOpenRequest(client, { segment: "COMFORT" });
    await sendOffer(loser, offerInput(open));

    expect((await getIncomingRequest(executor, requestId)).address).toBe("ул. Тестовая, 1, кв. 2");
    expect((await getIncomingRequest(loser, open)).address).toBeNull();
    await expect(getIncomingRequest(loser, requestId)).rejects.toThrow(code("NOT_FOUND"));
  });
});

describe("отклик исполнителя", () => {
  it("берёт условия замера из профиля по умолчанию и уведомляет заказчика", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const executor = await makeExecutorWithTerms("COMFORT", "FEE_IF_NO_DEAL", 10_000);

    const { offerId } = await sendOffer(executor, offerInput(requestId, 700_000));

    expect(await db.offer.findUniqueOrThrow({ where: { id: offerId } })).toMatchObject({
      status: "SENT",
      price: 700_000,
      measurementTerms: "FEE_IF_NO_DEAL",
      measurementFee: 10_000,
    });
    expect(await db.notification.findFirst({ where: { userId: client.id, kind: "offer.received" } })).not.toBeNull();
    expect(await db.auditEvent.findFirst({ where: { action: "offer.sent", entityId: offerId } })).toMatchObject({ scope: `request:${requestId}` });
  });

  it("условия замера в отклике можно уточнить", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const executor = await makeExecutorWithTerms("COMFORT", "FEE_IF_NO_DEAL", 10_000);
    const { offerId } = await sendOffer(executor, { ...offerInput(requestId), measurementTerms: "FREE" });
    expect(await db.offer.findUniqueOrThrow({ where: { id: offerId } })).toMatchObject({ measurementTerms: "FREE", measurementFee: null });
  });

  it("один отклик на исполнителя — и повтором, и в гонке", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const executor = await makeExecutor({ segment: "COMFORT" });

    const results = await Promise.allSettled([sendOffer(executor, offerInput(requestId)), sendOffer(executor, offerInput(requestId, 1))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: code("CONFLICT") });
    await expect(sendOffer(executor, offerInput(requestId))).rejects.toThrow(code("CONFLICT"));
    expect(await db.offer.count({ where: { requestId } })).toBe(1);
  });

  it("на невидимую, чужого сегмента или закрытую заявку отклик не отправляется", async () => {
    const client = await makeClient();
    const draft = await makeDraft(client);
    const premium = await makeOpenRequest(client, { segment: "PREMIUM" });
    const executor = await makeExecutor({ segment: "COMFORT" });
    const { requestId: chosen } = await makeChosen(client);

    await expect(sendOffer(executor, offerInput(draft))).rejects.toThrow(code("NOT_FOUND"));
    await expect(sendOffer(executor, offerInput(premium))).rejects.toThrow(code("NOT_FOUND"));
    await expect(sendOffer(executor, offerInput(chosen))).rejects.toThrow(code("NOT_FOUND"));
    await expect(sendOffer(client, offerInput(premium))).rejects.toThrow(code("FORBIDDEN"));
  });

  it("исполнитель отзывает свой отклик до выбора: SENT → WITHDRAWN", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const executor = await makeExecutor({ segment: "COMFORT" });
    const stranger = await makeExecutor({ segment: "COMFORT" });
    const { offerId } = await sendOffer(executor, offerInput(requestId));

    await expect(withdrawOffer(stranger, { offerId })).rejects.toThrow(code("NOT_FOUND"));
    await withdrawOffer(executor, { offerId });
    expect((await db.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("WITHDRAWN");
    await expect(withdrawOffer(executor, { offerId })).rejects.toThrow(code("CONFLICT"));
    await expect(sendOffer(executor, offerInput(requestId))).rejects.toThrow(code("CONFLICT"));
  });

  it("выбранный отклик отозвать нельзя", async () => {
    const { executor, offerId } = await makeChosen(await makeClient());
    await expect(withdrawOffer(executor, { offerId })).rejects.toThrow(code("CONFLICT"));
  });
});

describe("список откликов и сортировка", () => {
  async function threeOffers() {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const [a, b, c, gone] = await Promise.all([1, 2, 3, 4].map(() => makeExecutor({ segment: "COMFORT" })));
    await db.executorProfile.update({ where: { id: a.executor.id }, data: { ratingAvg: 4.2 } });
    await db.executorProfile.update({ where: { id: b.executor.id }, data: { ratingAvg: 4.9 } });
    await db.executorProfile.update({ where: { id: c.executor.id }, data: { ratingAvg: 4.5 } });
    const ids = {
      a: (await sendOffer(a, offerInput(requestId, 900_000, { durationDays: 20 }))).offerId,
      b: (await sendOffer(b, offerInput(requestId, 1_100_000, { durationDays: 40 }))).offerId,
      c: (await sendOffer(c, offerInput(requestId, 700_000, { durationDays: 30 }))).offerId,
    };
    const { offerId: withdrawn } = await sendOffer(gone, offerInput(requestId, 1));
    await withdrawOffer(gone, { offerId: withdrawn });
    return { client, requestId, ids };
  }

  it("сортирует по цене, сроку и рейтингу и не показывает отозванные", async () => {
    const { client, requestId, ids } = await threeOffers();
    const order = async (sort: "price" | "duration" | "rating") => (await listOffers(client, { requestId, sort })).map((o) => o.id);

    expect(await order("price")).toEqual([ids.c, ids.a, ids.b]);
    expect(await order("duration")).toEqual([ids.a, ids.c, ids.b]);
    expect(await order("rating")).toEqual([ids.b, ids.c, ids.a]);
  });

  it("заказчик видит исполнителя только как «Исполнитель №N»", async () => {
    const { client, requestId, ids } = await threeOffers();
    const offer = await getOfferForClient(client, { requestId, offerId: ids.a });
    expect(offer.executor.label).toMatch(/^Исполнитель №\d+$/);
    expect(JSON.stringify(offer)).not.toMatch(/ИП Тестовый|\+7700/);
  });

  it("чужие отклики не видны (IDOR)", async () => {
    const { requestId, ids } = await threeOffers();
    const stranger = await makeClient();
    await expect(listOffers(stranger, { requestId, sort: "price" })).rejects.toThrow(code("NOT_FOUND"));
    await expect(getOfferForClient(stranger, { requestId, offerId: ids.a })).rejects.toThrow(code("NOT_FOUND"));
  });
});

describe("выбор отклика OPEN → OFFER_CHOSEN", () => {
  it("выбранный ACCEPTED, остальные DECLINED, обе стороны уведомлены", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const [win, lose] = await Promise.all([makeExecutor({ segment: "COMFORT" }), makeExecutor({ segment: "COMFORT" })]);
    const { offerId } = await sendOffer(win, offerInput(requestId));
    const { offerId: other } = await sendOffer(lose, offerInput(requestId));

    await chooseOffer(client, { offerId });

    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("OFFER_CHOSEN");
    expect((await db.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("ACCEPTED");
    expect((await db.offer.findUniqueOrThrow({ where: { id: other } })).status).toBe("DECLINED");
    expect(await db.notification.findFirst({ where: { userId: win.id, kind: "offer.chosen" } })).not.toBeNull();
    expect(await db.notification.findFirst({ where: { userId: lose.id, kind: "offer.declined" } })).not.toBeNull();
  });

  it("параллельный выбор двух откликов даёт ровно один выбор", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const [a, b] = await Promise.all([makeExecutor({ segment: "COMFORT" }), makeExecutor({ segment: "COMFORT" })]);
    const offers = [(await sendOffer(a, offerInput(requestId))).offerId, (await sendOffer(b, offerInput(requestId))).offerId];

    const results = await Promise.allSettled(offers.map((offerId) => chooseOffer(client, { offerId })));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.offer.count({ where: { requestId, status: "ACCEPTED" } })).toBe(1);
    expect(await db.offer.count({ where: { requestId, status: "DECLINED" } })).toBe(1);
  });

  it("выбрать может только владелец заявки и только отправленный отклик", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const executor = await makeExecutor({ segment: "COMFORT" });
    const { offerId } = await sendOffer(executor, offerInput(requestId));

    await expect(chooseOffer(await makeClient(), { offerId })).rejects.toThrow(code("NOT_FOUND"));
    await expect(chooseOffer(executor, { offerId })).rejects.toThrow(code("FORBIDDEN"));
    await withdrawOffer(executor, { offerId });
    await expect(chooseOffer(client, { offerId })).rejects.toThrow(code("CONFLICT"));
  });
});
