import { afterEach, describe, expect, it, vi } from "vitest";
import { onMoneySettled, payForDeal, startWork, submitReady } from "@/modules/deal-core";
import { db, transaction } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { ADDRESS, confirmPending, dealAt, dealOf, makeDeal, makePhoto, signAct, signContract } from "../../../test/factories/deal";
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
