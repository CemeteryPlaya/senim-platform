import { afterEach, describe, expect, it, vi } from "vitest";
import { RevealPurpose } from "@/gen/senim/identity/v1/identity_pb";
import { onMoneySettled, payForDeal, startWork, submitReady } from "@/modules/deal-core";
import { db, transaction } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { ADDRESS, confirmPending, dealAt, dealOf, journalOf, makeDeal, makePhoto, signAct, signContract } from "../../../test/factories/deal";
import { identityFake } from "../../../test/stubs/identity";
import { executeDealOperations } from "./execute";
import { moneyKey } from "./keys";
import { recordOperation } from "./ledger";
import { failManualOperation, manualProvider } from "./providers/manual";
import { mockProvider } from "./providers/mock";

afterEach(() => vi.restoreAllMocks());

describe("исполнение: раскрытие и возврат идут по подтверждённой оплате журнала", () => {
  it("первая оплата отклонена, вторая прошла — release получает ключ и номер второй попытки", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(f.client, { dealId: f.dealId });
    const first = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId, type: "HOLD" } });
    await failManualOperation(await makeOperator(), { transactionId: first.id, reason: "Платёж не поступил" }, onMoneySettled);
    await payForDeal(f.client, { dealId: f.dealId });
    await confirmPending(f.dealId, "HOLD");
    const held = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId, type: "HOLD", status: "SUCCEEDED" } });
    expect(held.idempotencyKey).toBe(`hold:${f.dealId}:2`);

    await startWork(f.executor, { dealId: f.dealId });
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], ...ADDRESS, accuracyM: 10 });
    const release = vi.spyOn(manualProvider, "release");
    await signAct(f.dealId);
    const { processDealMoney } = await import("@/modules/deal-core");
    await processDealMoney(f.dealId);

    expect(release).toHaveBeenCalledWith(expect.objectContaining({ hold: { idempotencyKey: held.idempotencyKey, externalRef: held.externalRef } }));
  });

  it("возврат при отмене — тоже по подтверждённой оплате", async () => {
    const f = await dealAt("PAID_HOLD", { provider: "manual" });
    const held = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId, type: "HOLD", status: "SUCCEEDED" } });
    const refund = vi.spyOn(manualProvider, "refund");
    const { cancelDeal } = await import("@/modules/deal-core");
    await cancelDeal(f.client, { dealId: f.dealId });
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ hold: { idempotencyKey: held.idempotencyKey, externalRef: held.externalRef } }));
  });
});

describe("исполнение: что роняет задачу, а что нет", () => {
  async function pendingMockHold() {
    const f = await makeDeal();
    await signContract(f.dealId);
    const deal = await dealOf(f.dealId);
    const { entry } = await transaction((tx) =>
      recordOperation(tx, { dealId: f.dealId, type: "HOLD", amountTiyn: deal.buyerTotalTiyn, idempotencyKey: moneyKey.hold(f.dealId), provider: "MOCK", isTest: true }),
    );
    return { ...f, op: entry };
  }

  it("сбой вызова провайдера — не роняет: операция ждёт опроса", async () => {
    const { op } = await pendingMockHold();
    vi.spyOn(mockProvider, "hold").mockRejectedValueOnce(new Error("сеть"));
    await expect(executeDealOperations(op.dealId, onMoneySettled)).resolves.toBeInstanceOf(Map);
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "PENDING" });
  });

  it("сбой записи итога (хук сделки) — роняет, итог откатывается; повтор задачи проводит операцию", async () => {
    const { op, dealId } = await pendingMockHold();
    const broken = async () => {
      throw new Error("хук упал");
    };
    await expect(executeDealOperations(dealId, broken)).rejects.toThrow("хук упал");
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "PENDING" });
    await executeDealOperations(dealId, onMoneySettled);
    expect(await dealOf(dealId)).toMatchObject({ status: "PAID_HOLD" });
  });
});

describe("выплата мастеру: IBAN — из identity", () => {
  it("split получает IBAN из RevealPartyDetails (цель PAYOUT, сделка, без сессии — фоновая задача)", async () => {
    const IBAN = "KZ86125KZT5004100100";
    const f = await dealAt("READY");
    identityFake.setPayoutIbanOf(f.executor.id, IBAN);
    identityFake.calls.length = 0;
    const split = vi.spyOn(mockProvider, "split");
    await signAct(f.dealId);
    const { processDealMoney } = await import("@/modules/deal-core");
    await processDealMoney(f.dealId);

    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: f.executor.executor.id }, select: { legalName: true } });
    expect(split).toHaveBeenCalledWith(expect.objectContaining({ master: expect.objectContaining({ recipient: { iban: IBAN, name: profile.legalName } }) }));
    const reveals = identityFake.calls.filter((c) => c.method === "revealPartyDetails").map((c) => c.request);
    expect(reveals).toEqual([expect.objectContaining({ userIds: [f.executor.id], purpose: RevealPurpose.PAYOUT, referenceId: f.dealId, actorSessionToken: "" })]);
    // Суммы выплаты — из журнала, как и прежде.
    expect((await journalOf(f.dealId)).filter((e) => e.type === "SPLIT_MASTER").map((e) => e.amountTiyn)).toEqual([96_000_00n]);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
  });

  it("мастера нет в identity — split без IBAN (провайдер решает сам), сбоя нет", async () => {
    const f = await dealAt("READY");
    identityFake.reset();
    const split = vi.spyOn(mockProvider, "split");
    await signAct(f.dealId);
    const { processDealMoney } = await import("@/modules/deal-core");
    await processDealMoney(f.dealId);
    expect(split).toHaveBeenCalledWith(expect.objectContaining({ master: expect.objectContaining({ recipient: expect.objectContaining({ iban: null }) }) }));
  });
});
