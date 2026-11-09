import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeExecutorWithTerms, makeOpenRequest, offerInput, openProposal, withFeature } from "../../../test/factories/requests";
import { acceptPrice, cancelRequest, chooseOffer, getNegotiation, proposePrice, sendOffer, withdrawPrice } from "./index";

/**
 * Путь ТЗ (решение 2.2.9) и торг (решение 2.2.3): заявка → отклики и торг → акцепт цены → оферта.
 * Флаг preContractFlows по умолчанию выключен; сценарии до договора — в pre-contract/measurements тестах.
 */

const code = (c: string) => expect.objectContaining({ code: c });
const one = (results: PromiseSettledResult<unknown>[]) => results.filter((r) => r.status === "fulfilled").length;
const proposals = (offerId: string) => db.priceProposal.findMany({ where: { offerId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const statusOf = async (requestId: string) => (await db.request.findUniqueOrThrow({ where: { id: requestId } })).status;

/** Открытая заявка покупателя и отклик мастера за 500 000 ₸. */
async function offered() {
  const client = await makeClient();
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const executor = await makeExecutorWithTerms("COMFORT");
  const { offerId } = await sendOffer(executor, offerInput(requestId, 500_000));
  return { client, requestId, executor, offerId };
}

describe("путь заявки в обоих положениях флага preContractFlows", () => {
  it("флаг выключен: путь ТЗ — цена отклика становится первым предложением торга, выбора без торга нет", async () => {
    const { client, requestId, executor, offerId } = await offered();

    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).preContractFlow).toBeNull();
    expect(await proposals(offerId)).toEqual([
      expect.objectContaining({ party: "EXECUTOR", authorId: executor.id, amountTiyn: 500_000_00n, status: "PROPOSED" }),
    ]);
    await expect(chooseOffer(client, { offerId })).rejects.toThrow(code("FORBIDDEN"));
  });

  it("флаг включён: заявка идёт сценарием до договора — торга нет, выбор отклика работает", async () => {
    await withFeature("FEATURE_PRE_CONTRACT_FLOWS", true, async () => {
      const { client, requestId, offerId } = await offered();

      expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).preContractFlow).toBe("EXECUTOR_MEASURE");
      expect(await proposals(offerId)).toEqual([]);
      await expect(proposePrice(client, { offerId, amountKzt: 450_000 })).rejects.toThrow(code("CONFLICT"));
      await chooseOffer(client, { offerId });
      expect(await statusOf(requestId)).toBe("OFFER_CHOSEN");
    });
  });

  it("заявка пути ТЗ остаётся на нём и после включения флага: снимок при отправке", async () => {
    const { client, offerId } = await offered();
    await withFeature("FEATURE_PRE_CONTRACT_FLOWS", true, async () => {
      await expect(chooseOffer(client, { offerId })).rejects.toThrow(code("CONFLICT"));
      await expect(proposePrice(client, { offerId, amountKzt: 450_000 })).resolves.toEqual({ proposalId: expect.any(String) });
    });
  });
});

describe("торг: раунды предложений", () => {
  it("встречная цена: прежнее SUPERSEDED, новое PROPOSED; другая сторона уведомлена, событие в журнале", async () => {
    const { client, requestId, executor, offerId } = await offered();

    await proposePrice(client, { offerId, amountKzt: 420_000 });
    await proposePrice(executor, { offerId, amountKzt: 470_000 });

    expect((await proposals(offerId)).map((p) => [p.party, p.amountTiyn, p.status])).toEqual([
      ["EXECUTOR", 500_000_00n, "SUPERSEDED"],
      ["CLIENT", 420_000_00n, "SUPERSEDED"],
      ["EXECUTOR", 470_000_00n, "PROPOSED"],
    ]);
    expect(await db.notification.count({ where: { userId: executor.id, kind: "price.proposed" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: client.id, kind: "price.proposed" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "price.countered", scope: `request:${requestId}` } })).toBe(2);
    expect(await statusOf(requestId)).toBe("OPEN");
  });

  it("своё отзывают, чужое — нет; после отзыва любая сторона предлагает заново", async () => {
    const { client, executor, offerId } = await offered();
    const opening = await openProposal(offerId);

    await expect(withdrawPrice(client, { proposalId: opening.id })).rejects.toThrow(code("FORBIDDEN"));
    await withdrawPrice(executor, { proposalId: opening.id });
    await expect(withdrawPrice(executor, { proposalId: opening.id })).rejects.toThrow(code("CONFLICT"));
    expect(await db.notification.count({ where: { userId: client.id, kind: "price.withdrawn" } })).toBe(1);

    await proposePrice(client, { offerId, amountKzt: 430_000 });
    expect(await openProposal(offerId)).toMatchObject({ party: "CLIENT", amountTiyn: 430_000_00n });
  });

  it("своё предложение не принять и не перебить; та же цена — не встречная", async () => {
    const { client, executor, offerId } = await offered();
    const opening = await openProposal(offerId);

    await expect(acceptPrice(executor, { proposalId: opening.id })).rejects.toThrow(code("FORBIDDEN"));
    await expect(proposePrice(executor, { offerId, amountKzt: 490_000 })).rejects.toThrow(code("FORBIDDEN"));
    await expect(proposePrice(client, { offerId, amountKzt: 500_000 })).rejects.toThrow(code("VALIDATION"));
    expect(await proposals(offerId)).toHaveLength(1);
  });

  it("заменённое и отозванное предложение не принять", async () => {
    const { client, executor, offerId } = await offered();
    const opening = await openProposal(offerId);
    await proposePrice(client, { offerId, amountKzt: 420_000 });

    await expect(acceptPrice(client, { proposalId: opening.id })).rejects.toThrow(code("CONFLICT")); // уже заменено встречной
    await expect(acceptPrice(executor, { proposalId: opening.id })).rejects.toThrow(code("FORBIDDEN")); // своё
    const mine = await openProposal(offerId);
    await withdrawPrice(client, { proposalId: mine.id });
    await expect(acceptPrice(executor, { proposalId: mine.id })).rejects.toThrow(code("CONFLICT"));
  });
});

describe("акцепт цены → оферта", () => {
  it("покупатель принимает цену мастера: X зафиксирована, сделка с офертой, остальные отклики закрыты", async () => {
    const { client, requestId, executor, offerId } = await offered();
    const loser = await makeExecutor({ segment: "COMFORT" });
    const { offerId: other } = await sendOffer(loser, offerInput(requestId, 450_000));
    await proposePrice(client, { offerId, amountKzt: 480_000 });
    await proposePrice(executor, { offerId, amountKzt: 490_000 });

    const { dealId } = await acceptPrice(client, { proposalId: (await openProposal(offerId)).id });

    expect(await db.deal.findUniqueOrThrow({ where: { id: dealId } })).toMatchObject({
      priceTiyn: 490_000_00n,
      status: "CREATED",
      offerId,
      clientId: client.id,
      executorId: executor.executor.id,
    });
    expect(await db.document.count({ where: { dealId, kind: "CONTRACT" } })).toBe(1);
    expect(await statusOf(requestId)).toBe("CONTRACTING");
    expect((await db.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("ACCEPTED");
    expect((await db.offer.findUniqueOrThrow({ where: { id: other } })).status).toBe("DECLINED");
    expect((await proposals(offerId)).at(-1)).toMatchObject({ status: "ACCEPTED", decidedById: client.id, decidedAt: expect.any(Date) });
    expect(await db.notification.count({ where: { userId: loser.id, kind: "offer.declined" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: executor.id, kind: "deal.offer.ready" } })).toBe(1);
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "price.accepted" } })).toMatchObject({ actorId: client.id, scope: `request:${requestId}` });

    // Торг закрыт: ни цен, ни второго акцепта; другой мастер больше не откликнется.
    await expect(proposePrice(client, { offerId, amountKzt: 1 })).rejects.toThrow(code("CONFLICT"));
    await expect(proposePrice(loser, { offerId: other, amountKzt: 440_000 })).rejects.toThrow(code("CONFLICT"));
  });

  it("мастер принимает встречную цену покупателя", async () => {
    const { client, requestId, executor, offerId } = await offered();
    await proposePrice(client, { offerId, amountKzt: 455_555 });

    const { dealId } = await acceptPrice(executor, { proposalId: (await openProposal(offerId)).id });

    expect((await db.deal.findUniqueOrThrow({ where: { id: dealId } })).priceTiyn).toBe(455_555_00n);
    expect(await statusOf(requestId)).toBe("CONTRACTING");
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "price.accepted" } })).toMatchObject({ actorId: executor.id });
  });

  it("смета до оплаты: покупателю — с защитой сделки 2 %, мастеру — с гарантией 4 % от текущей цены", async () => {
    const { client, executor, offerId } = await offered();
    await proposePrice(client, { offerId, amountKzt: 400_000 });

    const forClient = await getNegotiation(client, { offerId });
    const forExecutor = await getNegotiation(executor, { offerId });

    expect(forClient).toMatchObject({
      party: "CLIENT",
      live: true,
      priceTiyn: 400_000_00n,
      estimate: { priceTiyn: 400_000_00n, extraTiyn: 8_000_00n, totalTiyn: 408_000_00n },
      can: { propose: false, accept: false, withdraw: true },
    });
    expect(forExecutor).toMatchObject({
      party: "EXECUTOR",
      estimate: { priceTiyn: 400_000_00n, extraTiyn: 16_000_00n, totalTiyn: 384_000_00n },
      can: { propose: true, accept: true, withdraw: false },
    });
    expect(forClient.rounds.map((r) => [r.party, r.mine, r.status])).toEqual([
      ["EXECUTOR", false, "SUPERSEDED"],
      ["CLIENT", true, "PROPOSED"],
    ]);

    const { dealId } = await acceptPrice(executor, { proposalId: forClient.open!.id });
    expect(await getNegotiation(client, { offerId })).toMatchObject({ live: false, dealId, can: { propose: false, accept: false, withdraw: false } });
  });
});

describe("гонки", () => {
  it("двойной клик «Принять» — одна сделка", async () => {
    const { client, requestId, offerId } = await offered();
    const proposalId = (await openProposal(offerId)).id;

    const results = await Promise.allSettled([acceptPrice(client, { proposalId }), acceptPrice(client, { proposalId })]);

    expect(one(results)).toBe(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: code("CONFLICT") });
    expect(await db.deal.count({ where: { requestId } })).toBe(1);
  });

  it("база не даёт второго открытого предложения по отклику (частичный уникальный индекс)", async () => {
    const { client, offerId } = await offered();
    await proposePrice(client, { offerId, amountKzt: 400_000 });
    const second = db.priceProposal.create({ data: { offerId, authorId: client.id, party: "CLIENT", amountTiyn: 41_000_000n } });
    await expect(second).rejects.toMatchObject({ code: "P2002" });
  });

  it("две встречные цены одновременно — одна PROPOSED", async () => {
    const { client, executor, offerId } = await offered();
    await proposePrice(client, { offerId, amountKzt: 400_000 });
    await withdrawPrice(client, { proposalId: (await openProposal(offerId)).id });

    // Открытого нет: обе стороны предлагают сразу. Вызовы пересеклись — частичный уникальный индекс пускает одно, второе — CONFLICT;
    // не пересеклись (медленная машина) — второе законно становится встречным. В обоих случаях открытое предложение одно.
    const fresh = await Promise.allSettled([proposePrice(client, { offerId, amountKzt: 410_000 }), proposePrice(executor, { offerId, amountKzt: 480_000 })]);
    expect(one(fresh)).toBeGreaterThanOrEqual(1);
    for (const r of fresh) if (r.status === "rejected") expect(r.reason).toEqual(code("CONFLICT"));
    expect(await db.priceProposal.count({ where: { offerId, status: "PROPOSED" } })).toBe(1);

    // Открытое есть: две встречные на него (другая сторона жмёт дважды) — одна.
    const open = await openProposal(offerId);
    const counter = open.party === "CLIENT" ? executor : client;
    const twice = await Promise.allSettled([proposePrice(counter, { offerId, amountKzt: 445_000 }), proposePrice(counter, { offerId, amountKzt: 446_000 })]);
    expect(one(twice)).toBe(1);
    expect(await db.priceProposal.count({ where: { offerId, status: "PROPOSED" } })).toBe(1);
  });

  it("акцепт по двум откликам одной заявки одновременно — одна сделка, второй отклик отклонён", async () => {
    const { client, requestId, offerId } = await offered();
    const second = await makeExecutorWithTerms("COMFORT");
    const { offerId: other } = await sendOffer(second, offerInput(requestId, 520_000));
    await proposePrice(client, { offerId: other, amountKzt: 470_000 });

    const results = await Promise.allSettled([
      acceptPrice(client, { proposalId: (await openProposal(offerId)).id }),
      acceptPrice(second, { proposalId: (await openProposal(other)).id }),
    ]);

    expect(one(results)).toBe(1);
    expect(await db.deal.count({ where: { requestId } })).toBe(1);
    expect(await db.offer.count({ where: { requestId, status: "ACCEPTED" } })).toBe(1);
    expect(await db.offer.count({ where: { requestId, status: "DECLINED" } })).toBe(1);
  });
});

describe("права (IDOR)", () => {
  it("торг видят и ведут только покупатель заявки и мастер этого отклика", async () => {
    const { offerId } = await offered();
    const proposalId = (await openProposal(offerId)).id;
    const strangers = [await makeClient(), await makeExecutor({ segment: "COMFORT" }), await makeOperator()];

    for (const stranger of strangers) {
      await expect(getNegotiation(stranger, { offerId })).rejects.toThrow(code("NOT_FOUND"));
      await expect(proposePrice(stranger, { offerId, amountKzt: 1_000 })).rejects.toThrow(code("NOT_FOUND"));
      await expect(acceptPrice(stranger, { proposalId })).rejects.toThrow(code("NOT_FOUND"));
      await expect(withdrawPrice(stranger, { proposalId })).rejects.toThrow(code("NOT_FOUND"));
    }
    expect(await db.priceProposal.count({ where: { offerId } })).toBe(1);
    expect(await db.deal.count()).toBe(0);
  });

  it("мастер, которому оператор отказал в регистрации, торг не ведёт", async () => {
    const { executor, offerId } = await offered();
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { status: "REJECTED" } });
    await expect(getNegotiation(executor, { offerId })).rejects.toThrow(code("FORBIDDEN"));
  });
});

describe("отмена заявки на пути ТЗ", () => {
  it("отклики отклонены, торг закрыт", async () => {
    const { client, requestId, executor, offerId } = await offered();
    await cancelRequest(client, { requestId });

    expect((await db.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("DECLINED");
    await expect(proposePrice(executor, { offerId, amountKzt: 450_000 })).rejects.toThrow(code("CONFLICT"));
    await expect(acceptPrice(client, { proposalId: (await openProposal(offerId)).id })).rejects.toThrow(code("CONFLICT"));
  });
});
