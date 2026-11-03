import { afterEach, describe, expect, it, vi } from "vitest";
import { onMoneySettled, payForDeal, startWork, submitReady } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { ADDRESS, confirmPending, dealAt, makePhoto, signAct } from "../../../test/factories/deal";
import { failManualOperation, manualProvider } from "./providers/manual";

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
