import { describe, expect, it } from "vitest";
import { makeClient, makeExecutor } from "../../../test/factories";
import { makeExecutorWithTerms, makeOpenRequest, offerInput, openProposal, withFeature } from "../../../test/factories/requests";
import { acceptPrice, myOfferStates, proposePrice, sendOffer, withdrawOffer, withdrawPrice } from "./index";

const code = (c: string) => expect.objectContaining({ code: c });

/** Открытая заявка покупателя и два отклика мастеров: 500 000 ₸ и 600 000 ₸. */
async function twoOffers() {
  const client = await makeClient();
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const first = await makeExecutorWithTerms("COMFORT");
  const second = await makeExecutorWithTerms("COMFORT");
  const a = await sendOffer(first, offerInput(requestId, 500_000));
  const b = await sendOffer(second, offerInput(requestId, 600_000));
  return { client, requestId, first, second, a: a.offerId, b: b.offerId };
}

const byOffer = (states: Awaited<ReturnType<typeof myOfferStates>>) => new Map(states.map((s) => [s.offerId, s]));

describe("myOfferStates: действующие цены предложений покупателя", () => {
  it("без торга — цена отклика; торг идёт — последняя цена мастера, а не первая и не цена покупателя", async () => {
    const { client, requestId, first, a, b } = await twoOffers();
    await proposePrice(client, { offerId: a, amountKzt: 450_000 });
    await proposePrice(first, { offerId: a, amountKzt: 480_000 });
    // Покупатель ответил ещё раз: открыта его цена, а у мастера последняя — 480 000.
    await proposePrice(client, { offerId: a, amountKzt: 470_000 });

    const states = byOffer(await myOfferStates(client, { requestId }));
    expect(states.get(a)).toMatchObject({ requestId, status: "SENT", live: true, priceTiyn: 480_000_00n, deal: null });
    expect(states.get(b)).toMatchObject({ status: "SENT", live: true, priceTiyn: 600_000_00n, deal: null });
  });

  it("отозванная цена мастера не считается: действует предыдущая названная им цена", async () => {
    const { client, requestId, first, a } = await twoOffers();
    await proposePrice(client, { offerId: a, amountKzt: 450_000 });
    const { proposalId } = await proposePrice(first, { offerId: a, amountKzt: 490_000 });
    await withdrawPrice(first, { proposalId });

    expect(byOffer(await myOfferStates(client, { requestId })).get(a)?.priceTiyn).toBe(500_000_00n);
  });

  it("предложение со сделкой — цена сделки и её статус; остальные закрыты (DECLINED, торг не идёт)", async () => {
    const { client, requestId, first, a, b } = await twoOffers();
    await proposePrice(client, { offerId: a, amountKzt: 450_000 });
    await proposePrice(first, { offerId: a, amountKzt: 470_000 });
    await acceptPrice(client, { proposalId: (await openProposal(a)).id });

    const states = byOffer(await myOfferStates(client, { requestId }));
    expect(states.get(a)).toMatchObject({ status: "ACCEPTED", live: false, priceTiyn: 470_000_00n, deal: { status: "CREATED" } });
    expect(states.get(b)).toMatchObject({ status: "DECLINED", live: false, priceTiyn: 600_000_00n, deal: null });
  });

  it("отозванный мастером отклик не отдаётся; без requestId — предложения всех своих заявок", async () => {
    const { client, requestId, second, a, b } = await twoOffers();
    await withdrawOffer(second, { offerId: b });
    const other = await makeOpenRequest(client, { segment: "COMFORT" });
    const third = await makeExecutorWithTerms("COMFORT");
    const { offerId: c } = await sendOffer(third, offerInput(other, 300_000));

    expect((await myOfferStates(client, { requestId })).map((s) => s.offerId)).toEqual([a]);
    expect((await myOfferStates(client)).map((s) => s.offerId).sort()).toEqual([a, c].sort());
  });

  it("заявка сценария до договора: отклик отправлен, но торга нет — не действует", async () => {
    await withFeature("FEATURE_PRE_CONTRACT_FLOWS", true, async () => {
      const client = await makeClient();
      const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
      const executor = await makeExecutorWithTerms("COMFORT");
      const { offerId } = await sendOffer(executor, offerInput(requestId, 400_000));
      expect(await myOfferStates(client, { requestId })).toEqual([
        expect.objectContaining({ offerId, status: "SENT", live: false, priceTiyn: 400_000_00n }),
      ]);
    });
  });

  it("права: чужая заявка — NOT_FOUND, мастер — FORBIDDEN, чужие предложения в общем списке не видны", async () => {
    const { requestId, first } = await twoOffers();
    const stranger = await makeClient();
    await expect(myOfferStates(stranger, { requestId })).rejects.toThrow(code("NOT_FOUND"));
    expect(await myOfferStates(stranger)).toEqual([]);
    await expect(myOfferStates(first)).rejects.toThrow(code("FORBIDDEN"));
    await expect(myOfferStates(await makeExecutor())).rejects.toThrow(code("FORBIDDEN"));
  });
});
