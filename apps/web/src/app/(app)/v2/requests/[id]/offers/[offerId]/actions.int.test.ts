import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { proposePrice, sendOffer, withdrawPrice } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../../../test/factories";
import { freshBrowser } from "../../../../../../../../test/factories/identity";
import { makeExecutorWithTerms, makeOpenRequest, offerInput, openProposal } from "../../../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../../../test/factories/session";
import { acceptPriceAction, proposePriceAction, withdrawPriceAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.offer.errors;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
});

/** Открытая заявка покупателя и предложение мастера за 500 000 ₸ (цена отклика — первое предложение торга). */
async function offered(priceKzt = 500_000) {
  const client = await makeClient();
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const executor = await makeExecutorWithTerms("COMFORT");
  const { offerId } = await sendOffer(executor, offerInput(requestId, priceKzt));
  const opening = await openProposal(offerId);
  return { client, requestId, executor, offerId, opening };
}

const dealsOf = (offerId: string) => db.deal.findMany({ where: { offerId } });
const failed = (code: string, error: string) => expect.objectContaining({ ok: false, code, error });

describe("acceptPriceAction: принять цену мастера → сделка", () => {
  it("два параллельных вызова (двойное нажатие) — одна сделка, оба ответа ведут в неё; цена — принятое предложение", async () => {
    const { client, offerId, opening } = await offered(500_000);
    await signInAs(client);

    const [a, b] = await Promise.all([
      acceptPriceAction({ offerId, proposalId: opening.id }),
      acceptPriceAction({ offerId, proposalId: opening.id }),
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toEqual(a);
    const deals = await dealsOf(offerId);
    expect(deals).toHaveLength(1);
    if (!a.ok) throw new Error("не принято");
    expect(a.data.dealId).toBe(deals[0].id);
    expect(deals[0].priceTiyn).toBe(500_000_00n);
    expect((await db.priceProposal.findUniqueOrThrow({ where: { id: opening.id } })).status).toBe("ACCEPTED");

    // Повтор позже (вторая вкладка, «Назад» и снова «Принять») — та же сделка, модуль не вызывается.
    expect(await acceptPriceAction({ offerId, proposalId: opening.id })).toEqual(a);
    expect(await dealsOf(offerId)).toHaveLength(1);
  });

  it("смета сделки — та же формула: без доплат покупателя, выплата вниз до тиына (computeDealMoney, ADR-015)", async () => {
    const { client, offerId, opening } = await offered();
    // Цена с тиынами (1 000 000,01 ₸): 94% = 940 000,0094 ₸ → вниз до тиына.
    await db.priceProposal.update({ where: { id: opening.id }, data: { amountTiyn: 1_000_000_01n } });
    await signInAs(client);
    const res = await acceptPriceAction({ offerId, proposalId: opening.id });
    if (!res.ok) throw new Error(res.error);
    const deal = await db.deal.findUniqueOrThrow({ where: { id: res.data.dealId } });
    expect(deal.priceTiyn).toBe(1_000_000_01n);
    expect(deal).toMatchObject({ protectionTiyn: 0n, buyerTotalTiyn: 1_000_000_01n, payoutTiyn: 940_000_00n });
  });

  it("гонка: мастер ответил новой ценой, пока покупатель смотрел — CONFLICT с текстом экрана, сделки нет", async () => {
    const { client, executor, offerId, opening } = await offered();
    await proposePrice(client, { offerId, amountKzt: 450_000 });
    await proposePrice(executor, { offerId, amountKzt: 480_000 });
    await signInAs(client);

    expect(await acceptPriceAction({ offerId, proposalId: opening.id })).toEqual(failed("CONFLICT", t.changed));
    expect(await dealsOf(offerId)).toHaveLength(0);
    // Новая цена мастера принимается своим предложением.
    const fresh = await openProposal(offerId);
    const res = await acceptPriceAction({ offerId, proposalId: fresh.id });
    expect(res).toMatchObject({ ok: true });
    expect((await dealsOf(offerId))[0].priceTiyn).toBe(480_000_00n);
  });

  it("гонка: мастер отозвал цену — CONFLICT, сделки нет", async () => {
    const { client, executor, offerId, opening } = await offered();
    await withdrawPrice(executor, { proposalId: opening.id });
    await signInAs(client);
    expect(await acceptPriceAction({ offerId, proposalId: opening.id })).toEqual(failed("CONFLICT", t.changed));
    expect(await dealsOf(offerId)).toHaveLength(0);
  });

  it("своё предложение не принять — экран устарел (CONFLICT по смыслу, текст «цена изменилась»)", async () => {
    const { client, offerId } = await offered();
    await signInAs(client);
    const { proposalId } = await proposePrice(client, { offerId, amountKzt: 450_000 });
    expect(await acceptPriceAction({ offerId, proposalId })).toEqual(failed("FORBIDDEN", t.changed));
    expect(await dealsOf(offerId)).toHaveLength(0);
  });

  it("предложение другого отклика той же заявки под чужим offerId — NOT_FOUND, сделки нет", async () => {
    const { client, requestId, offerId } = await offered();
    const other = await makeExecutorWithTerms("COMFORT");
    const { offerId: otherOffer } = await sendOffer(other, offerInput(requestId, 470_000));
    const foreign = await openProposal(otherOffer);
    await signInAs(client);
    expect(await acceptPriceAction({ offerId, proposalId: foreign.id })).toEqual(failed("NOT_FOUND", t.notFound));
    expect(await db.deal.count({ where: { requestId } })).toBe(0);
  });

  it("чужая заявка — NOT_FOUND, ничего не меняется", async () => {
    const { offerId, opening } = await offered();
    await signInAs(await makeClient());
    expect(await acceptPriceAction({ offerId, proposalId: opening.id })).toEqual(failed("NOT_FOUND", t.notFound));
    expect((await db.priceProposal.findUniqueOrThrow({ where: { id: opening.id } })).status).toBe("PROPOSED");
    expect(await dealsOf(offerId)).toHaveLength(0);
  });

  it("мастер этого отклика в роли мастера — FORBIDDEN первой строкой (только покупатель)", async () => {
    const { executor, offerId, opening } = await offered();
    await signInAs(executor);
    expect(await acceptPriceAction({ offerId, proposalId: opening.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await dealsOf(offerId)).toHaveLength(0);
  });

  it("без входа — UNAUTHENTICATED (форма уведёт на вход)", async () => {
    const { offerId, opening } = await offered();
    expect(await acceptPriceAction({ offerId, proposalId: opening.id })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});

describe("proposePriceAction: своя цена", () => {
  it("разделители разрядов допустимы; после — своё предложение ждёт мастера; второе подряд — «сначала отзовите»", async () => {
    const { client, offerId } = await offered();
    await signInAs(client);
    const res = await proposePriceAction({ offerId, amount: "450 000" });
    expect(res).toMatchObject({ ok: true });
    expect(await openProposal(offerId)).toMatchObject({ party: "CLIENT", amountTiyn: 450_000_00n });

    expect(await proposePriceAction({ offerId, amount: "440000" })).toEqual(failed("FORBIDDEN", t.waitAnswer));
  });

  it("та же цена, что у мастера, — ошибка у поля amount", async () => {
    const { client, offerId } = await offered(500_000);
    await signInAs(client);
    expect(await proposePriceAction({ offerId, amount: "500000" })).toEqual(
      expect.objectContaining({ ok: false, code: "VALIDATION", error: t.sameAmount, fieldErrors: { amount: [t.sameAmount] } }),
    );
  });

  it("не целое и ноль — ошибка у поля, модуль не вызывается", async () => {
    const { client, offerId } = await offered();
    await signInAs(client);
    for (const amount of ["12,5", "0", ""]) {
      const res = await proposePriceAction({ offerId, amount });
      expect(res).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { amount: [t.amount] } });
    }
    expect(await db.priceProposal.count({ where: { offerId } })).toBe(1);
  });

  it("чужая заявка — NOT_FOUND; заявка закрыта (сделка по другому отклику) — CONFLICT «цена изменилась»", async () => {
    const { client, requestId, offerId, opening } = await offered();
    await signInAs(await makeClient());
    expect(await proposePriceAction({ offerId, amount: "400000" })).toEqual(failed("NOT_FOUND", t.notFound));

    const other = await makeExecutorWithTerms("COMFORT");
    const { offerId: otherOffer } = await sendOffer(other, offerInput(requestId, 470_000));
    await signInAs(client);
    expect(await acceptPriceAction({ offerId: otherOffer, proposalId: (await openProposal(otherOffer)).id })).toMatchObject({ ok: true });
    expect(await proposePriceAction({ offerId, amount: "400000" })).toEqual(failed("CONFLICT", t.changed));
    expect((await db.priceProposal.findUniqueOrThrow({ where: { id: opening.id } })).status).toBe("PROPOSED");
  });
});

describe("withdrawPriceAction: отозвать своё", () => {
  it("своё открытое — отозвано; цену мастера отозвать нельзя (FORBIDDEN «только своё»)", async () => {
    const { client, offerId, opening } = await offered();
    await signInAs(client);
    expect(await withdrawPriceAction({ proposalId: opening.id })).toEqual(failed("FORBIDDEN", t.notYours));
    expect((await db.priceProposal.findUniqueOrThrow({ where: { id: opening.id } })).status).toBe("PROPOSED");

    const { proposalId } = await proposePrice(client, { offerId, amountKzt: 450_000 });
    expect(await withdrawPriceAction({ proposalId })).toEqual({ ok: true, data: undefined });
    expect((await db.priceProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("WITHDRAWN");
    // Повтор — уже отозвано.
    expect(await withdrawPriceAction({ proposalId })).toEqual(failed("CONFLICT", t.changed));
  });

  it("чужой покупатель не отзовёт чужое предложение — NOT_FOUND", async () => {
    const { client, offerId } = await offered();
    const { proposalId } = await proposePrice(client, { offerId, amountKzt: 450_000 });
    await signInAs(await makeClient());
    expect(await withdrawPriceAction({ proposalId })).toEqual(failed("NOT_FOUND", t.notFound));
    expect((await db.priceProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("PROPOSED");
  });
});
