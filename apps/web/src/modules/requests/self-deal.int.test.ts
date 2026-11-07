import { describe, expect, it } from "vitest";
import { createDeal, leaveReview } from "@/modules/deal-core";
import { db, transaction } from "@/platform/db";
import { actingAs, makeClient, makeExecutor } from "../../../test/factories";
import { makePortfolioItem } from "../../../test/factories/companies";
import { makeDeal } from "../../../test/factories/deal";
import { setEnv } from "../../../test/factories/identity";
import { makeDraft, makeOpenRequest, offerInput } from "../../../test/factories/requests";
import { getIncomingRequest, likeTarget, listIncomingRequests, publishRequest, sendOffer } from "./index";

/**
 * Самосделка запрещена (ADR-004): один человек с ролями заказчика и исполнителя не откликается
 * на свою заявку, не получает её прямым запросом, не заключает сделку сам с собой и не пишет себе отзыв.
 */

const code = (c: string) => expect.objectContaining({ code: c });

/** Подтверждённый исполнитель сегмента COMFORT, который также заказчик. */
async function person() {
  const executor = await makeExecutor({ segment: "COMFORT", roles: ["EXECUTOR", "CLIENT"] });
  return { executor, client: actingAs(executor, "CLIENT") };
}

describe("самосделка запрещена", () => {
  it("свою заявку-тендер исполнитель не видит во входящих и не может на неё откликнуться", async () => {
    const me = await person();
    const own = await makeOpenRequest(me.client, { segment: "COMFORT" });
    const foreign = await makeOpenRequest(await makeClient(), { segment: "COMFORT" });

    expect((await listIncomingRequests(me.executor)).map((r) => r.id)).toEqual([foreign]);
    await expect(getIncomingRequest(me.executor, own)).rejects.toThrow(code("NOT_FOUND"));
    await expect(sendOffer(me.executor, offerInput(own))).rejects.toThrow(code("NOT_FOUND"));
    expect(await db.offer.count({ where: { requestId: own } })).toBe(0);
  });

  it("прямой запрос самому себе по своей работе («Хочу похожее») не создаётся", async () => {
    const me = await person();
    const item = await makePortfolioItem(me.executor);

    await expect(likeTarget(item.id, me.client)).rejects.toThrow(code("NOT_FOUND"));
    await expect(makeDraft(me.client, { like: item.id, typeId: item.furnitureTypeId })).rejects.toThrow(code("NOT_FOUND"));
    expect(await db.request.count({ where: { clientId: me.client.id } })).toBe(0);
    // Чужой заказчик ту же работу выбирает как обычно.
    await expect(likeTarget(item.id, await makeClient())).resolves.toMatchObject({ id: item.id });
  });

  it("черновик прямого запроса, ставший самосделкой после выдачи роли, не отправляется", async () => {
    const executor = await makeExecutor({ segment: "COMFORT" });
    const item = await makePortfolioItem(executor);
    const client = await makeClient();
    const requestId = await makeDraft(client, { like: item.id, typeId: item.furnitureTypeId });
    // Подмена владельца черновика на самого исполнителя (как если бы это был его второй аккаунт-роль).
    await db.user.update({ where: { id: executor.id }, data: { roles: ["EXECUTOR", "CLIENT"] } });
    await db.request.update({ where: { id: requestId }, data: { clientId: executor.id } });

    await expect(publishRequest(actingAs({ ...executor, roles: ["EXECUTOR", "CLIENT"] }, "CLIENT"), { requestId })).rejects.toThrow(code("CONFLICT"));
  });

  it("сделку с самим собой не создать", async () => {
    const me = await person();
    const request = await db.request.create({ data: { clientId: me.client.id, mode: "TENDER", status: "CONTRACTING" } });
    const offer = await db.offer.create({
      data: { requestId: request.id, executorId: me.executor.executor.id, priceTiyn: 100_000_00n, durationDays: 10, warrantyMonths: 12, measurementTerms: "FREE", status: "ACCEPTED" },
    });

    await expect(
      transaction((tx) => createDeal(tx, { requestId: request.id, offerId: offer.id, title: "Сам себе", priceTiyn: 100_000_00n })),
    ).rejects.toThrow(code("CONFLICT"));
    expect(await db.deal.count()).toBe(0);
  });

  it("отзыв самому себе не оставить", async () => {
    const me = await person();
    const { dealId } = await makeDeal({ executor: me.executor });
    // Сделка, где заказчик — сам исполнитель (в обход createDeal, как данные до правила).
    await db.deal.update({ where: { id: dealId }, data: { clientId: me.client.id, status: "SPLIT_PAYOUT" } });

    // Отзывы — под флагом reviews: включаем, чтобы отказ был именно из-за самосделки.
    setEnv({ FEATURE_REVIEWS: "true" });
    try {
      await expect(leaveReview(me.client, { dealId, rating: 5 })).rejects.toThrow(code("FORBIDDEN"));
    } finally {
      setEnv({ FEATURE_REVIEWS: undefined });
    }
    expect(await db.review.count()).toBe(0);
  });
});
