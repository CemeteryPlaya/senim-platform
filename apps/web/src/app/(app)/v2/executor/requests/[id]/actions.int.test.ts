import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { partyEstimate } from "@/modules/payments";
import { getNegotiation, proposePrice, sendOffer, withdrawPrice } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../../test/factories";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { makeExecutorWithTerms, makeOpenRequest, offerInput, openProposal } from "../../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../../test/factories/session";
import { acceptPriceAction, proposePriceAction, sendOfferAction, withdrawOfferAction, withdrawPriceAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.masterOffer.errors;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
});

const form = (requestId: string, over: Record<string, string> = {}) => ({ requestId, price: "500 000", days: "30", warranty: "24", comment: "", ...over });
const failed = (code: string, error: string) => expect.objectContaining({ ok: false, code, error });
const offersOf = (requestId: string) => db.offer.findMany({ where: { requestId } });
const dealsOf = (offerId: string) => db.deal.findMany({ where: { offerId } });

/** Открытая заявка покупателя уровня COMFORT и одобренный мастер того же уровня, вошедший в роли мастера. */
async function openForMaster() {
  const client = await makeClient();
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const executor = await makeExecutorWithTerms("COMFORT");
  await signInAs(executor);
  return { client, requestId, executor };
}

/** Предложение мастера за 500 000 ₸ и встречная цена покупателя 450 000 ₸ (ждёт мастера). */
async function countered() {
  const { client, requestId, executor } = await openForMaster();
  const { offerId } = await sendOffer(executor, offerInput(requestId, 500_000));
  const { proposalId } = await proposePrice(client, { offerId, amountKzt: 450_000 });
  return { client, requestId, executor, offerId, proposalId };
}

describe("sendOfferAction: отправить предложение", () => {
  it("цена — первое предложение торга; двойная отправка (два параллельных вызова) — одно предложение, оба ответа одинаковы", async () => {
    const { requestId } = await openForMaster();
    const [a, b] = await Promise.all([sendOfferAction(form(requestId)), sendOfferAction(form(requestId))]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toEqual(a);
    const offers = await offersOf(requestId);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ priceTiyn: 500_000_00n, durationDays: 30, warrantyMonths: 24, status: "SENT" });
    expect(await openProposal(offers[0].id)).toMatchObject({ party: "EXECUTOR", amountTiyn: 500_000_00n });
    // Повтор позже с теми же условиями — тот же ответ; с другими — «уже отправили», второго предложения нет.
    expect(await sendOfferAction(form(requestId))).toEqual(a);
    expect(await sendOfferAction(form(requestId, { price: "490000" }))).toEqual(failed("CONFLICT", t.alreadySent));
    expect(await offersOf(requestId)).toHaveLength(1);
  });

  it("ошибки ввода — у полей, модуль не вызывается", async () => {
    const { requestId } = await openForMaster();
    const res = await sendOfferAction(form(requestId, { price: "12,5", days: "0", warranty: "121" }));
    expect(res).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { price: [t.price], days: [t.days], warranty: [t.warranty] } });
    expect(await offersOf(requestId)).toHaveLength(0);
  });

  it("заявка не видна мастеру (другой уровень) и несуществующая — NOT_FOUND «не принимает предложения»", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client, { segment: "PREMIUM" });
    await signInAs(await makeExecutorWithTerms("ECONOMY"));
    expect(await sendOfferAction(form(requestId))).toEqual(failed("NOT_FOUND", t.unavailable));
    expect(await sendOfferAction(form("no-such-request"))).toEqual(failed("NOT_FOUND", t.unavailable));
    expect(await offersOf(requestId)).toHaveLength(0);
  });

  it("мастер не одобрен — FORBIDDEN с текстом мастера; покупатель — FORBIDDEN первой строкой; без входа — UNAUTHENTICATED", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
    await signInAs(await makeExecutor({ segment: "COMFORT", status: "PENDING" }));
    expect(await sendOfferAction(form(requestId))).toEqual(failed("FORBIDDEN", t.notApproved));
    await signInAs(client);
    expect(await sendOfferAction(form(requestId))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    freshBrowser({ "user-agent": "vitest" });
    expect(await sendOfferAction(form(requestId))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await offersOf(requestId)).toHaveLength(0);
  });
});

describe("acceptPriceAction: мастер принимает цену покупателя → сделка", () => {
  it("принять дважды (два параллельных вызова) — одна сделка по цене покупателя, оба ответа ведут в неё; повтор позже — та же", async () => {
    const { offerId, proposalId } = await countered();
    const [a, b] = await Promise.all([acceptPriceAction({ offerId, proposalId }), acceptPriceAction({ offerId, proposalId })]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toEqual(a);
    const deals = await dealsOf(offerId);
    expect(deals).toHaveLength(1);
    if (!a.ok) throw new Error(a.error);
    expect(a.data.dealId).toBe(deals[0].id);
    expect(deals[0].priceTiyn).toBe(450_000_00n);
    expect(await acceptPriceAction({ offerId, proposalId })).toEqual(a);
    expect(await dealsOf(offerId)).toHaveLength(1);
  });

  it("«Вы получите» в подтверждении — смета модуля мастеру: partyEstimate(\"EXECUTOR\") по цене покупателя, до тиына", async () => {
    const { executor, offerId } = await countered();
    const n = await getNegotiation(executor, { offerId });
    expect(n.estimate).toEqual(partyEstimate("EXECUTOR", 450_000_00n));
    expect(n.estimate.totalTiyn).toBe(432_000_00n);
  });

  it("гонка: покупатель отозвал цену и назвал новую, пока мастер смотрел, — CONFLICT, сделки нет; новая принимается своим id", async () => {
    const { client, offerId, proposalId } = await countered();
    await withdrawPrice(client, { proposalId });
    await proposePrice(client, { offerId, amountKzt: 470_000 });
    expect(await acceptPriceAction({ offerId, proposalId })).toEqual(failed("CONFLICT", t.changed));
    expect(await dealsOf(offerId)).toHaveLength(0);
    const fresh = await openProposal(offerId);
    expect(await acceptPriceAction({ offerId, proposalId: fresh.id })).toMatchObject({ ok: true });
    expect((await dealsOf(offerId))[0].priceTiyn).toBe(470_000_00n);
  });

  it("свою цену не принять — экран устарел; чужое предложение под своим offerId — NOT_FOUND; сделки нет", async () => {
    const { requestId, executor, offerId } = await openForMaster().then(async (s) => ({ ...s, ...(await sendOffer(s.executor, offerInput(s.requestId))) }));
    const own = await openProposal(offerId);
    expect(await acceptPriceAction({ offerId, proposalId: own.id })).toEqual(failed("FORBIDDEN", t.changed));
    const other = await makeExecutorWithTerms("COMFORT");
    const { offerId: otherOffer } = await sendOffer(other, offerInput(requestId, 470_000));
    const foreign = await openProposal(otherOffer);
    await signInAs(executor);
    expect(await acceptPriceAction({ offerId, proposalId: foreign.id })).toEqual(failed("NOT_FOUND", t.notFound));
    expect(await db.deal.count({ where: { requestId } })).toBe(0);
  });

  it("чужое предложение (другой мастер) — NOT_FOUND, ничего не меняется", async () => {
    const { offerId, proposalId } = await countered();
    await signInAs(await makeExecutorWithTerms("COMFORT"));
    expect(await acceptPriceAction({ offerId, proposalId })).toEqual(failed("NOT_FOUND", t.notFound));
    expect((await db.priceProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("PROPOSED");
    expect(await dealsOf(offerId)).toHaveLength(0);
  });
});

describe("proposePriceAction: своя цена мастера", () => {
  it("встречная на цену покупателя — открыта цена мастера; вторая подряд — «сначала отзовите»; та же цена — у поля", async () => {
    const { offerId } = await countered();
    expect(await proposePriceAction({ offerId, amount: "450000" })).toEqual(
      expect.objectContaining({ ok: false, code: "VALIDATION", error: t.sameAmount, fieldErrors: { amount: [t.sameAmount] } }),
    );
    expect(await proposePriceAction({ offerId, amount: "480 000" })).toMatchObject({ ok: true });
    expect(await openProposal(offerId)).toMatchObject({ party: "EXECUTOR", amountTiyn: 480_000_00n });
    expect(await proposePriceAction({ offerId, amount: "470000" })).toEqual(failed("FORBIDDEN", t.waitAnswer));
  });

  it("гонка двух встречных (две вкладки) — открыта одна цена мастера", async () => {
    const { offerId } = await countered();
    const results = await Promise.all([proposePriceAction({ offerId, amount: "480000" }), proposePriceAction({ offerId, amount: "490000" })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.priceProposal.count({ where: { offerId, status: "PROPOSED" } })).toBe(1);
  });

  it("торг закрыт (покупатель отменил заявку) — CONFLICT «экран устарел»", async () => {
    const { requestId, offerId } = await countered();
    await db.request.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
    expect(await proposePriceAction({ offerId, amount: "480000" })).toEqual(failed("CONFLICT", t.changed));
  });
});

describe("withdrawPriceAction и withdrawOfferAction: отозвать", () => {
  it("свою цену — отозвана; цену покупателя — нельзя", async () => {
    const { offerId, proposalId } = await countered();
    expect(await withdrawPriceAction({ proposalId })).toEqual(failed("FORBIDDEN", t.notYours));
    const res = await proposePriceAction({ offerId, amount: "480000" });
    if (!res.ok) throw new Error(res.error);
    expect(await withdrawPriceAction({ proposalId: res.data.proposalId })).toMatchObject({ ok: true });
    expect((await db.priceProposal.findUniqueOrThrow({ where: { id: res.data.proposalId } })).status).toBe("WITHDRAWN");
  });

  it("предложение целиком — WITHDRAWN; повтор — CONFLICT «экран устарел»; чужое — NOT_FOUND", async () => {
    const { offerId } = await countered();
    expect(await withdrawOfferAction({ offerId })).toMatchObject({ ok: true });
    expect((await db.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("WITHDRAWN");
    expect(await withdrawOfferAction({ offerId })).toEqual(failed("CONFLICT", t.changed));
    await signInAs(await makeExecutorWithTerms("COMFORT"));
    expect(await withdrawOfferAction({ offerId })).toEqual(failed("NOT_FOUND", t.notFound));
  });
});
