import { describe, expect, it } from "vitest";
import { dealAt, dealOf, journalOf, makeDeal, PRICE } from "../../../test/factories/deal";
import { computeDealMoney, moneyView } from "@/modules/payments";
import { db } from "@/platform/db";
import { cancelDeal, openDispute, payForDeal, startWork } from "./index";

const money = computeDealMoney(PRICE);
const noop = { onCancelled: async () => {} };

describe("отмена до оплаты (CREATED)", () => {
  it.each(["client", "executor"] as const)("%s отменяет — CANCELLED, хук заявки в той же транзакции, вторая сторона уведомлена", async (who) => {
    const f = await makeDeal();
    const calls: string[] = [];
    const result = await cancelDeal(f[who], { dealId: f.dealId, reason: "Передумал" }, { onCancelled: async (_tx, id) => void calls.push(id) });
    expect(result).toEqual({ status: "CANCELLED" });
    expect(calls).toEqual([f.dealId]);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "CANCELLED" });
    expect(await journalOf(f.dealId)).toEqual([]);
    const other = who === "client" ? f.executor : f.client;
    expect(await db.notification.count({ where: { userId: other.id, kind: "deal.cancelled" } })).toBe(1);
  });

  it("пока оплата в банке (manual PENDING) — отменить нельзя", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(f.client, { dealId: f.dealId });
    await expect(cancelDeal(f.client, { dealId: f.dealId }, noop)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("отмена после оплаты (PAID_HOLD)", () => {
  it("покупатель: REFUND всего оплаченного → REFUNDED, деньги вернулись", async () => {
    const f = await dealAt("PAID_HOLD");
    expect(await cancelDeal(f.client, { dealId: f.dealId }, noop)).toEqual({ status: "REFUND_REQUESTED" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "REFUNDED" });
    const refund = (await journalOf(f.dealId)).find((t) => t.type === "REFUND");
    expect(refund).toMatchObject({ amountTiyn: money.buyerTotalTiyn, status: "SUCCEEDED", idempotencyKey: `refund:${f.dealId}` });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "refunded", amountTiyn: money.buyerTotalTiyn, settled: true, bankBalanceTiyn: 0n });
  });

  it("manual: пока возврат в банке — мастер не может начать, спор не открыть, сделка ещё PAID_HOLD", async () => {
    const f = await dealAt("PAID_HOLD", { provider: "manual" });
    await cancelDeal(f.client, { dealId: f.dealId }, noop);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "PAID_HOLD" });
    await expect(startWork(f.executor, { dealId: f.dealId })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(openDispute(f.executor, { dealId: f.dealId, reason: "OTHER", description: "Покупатель пропал после оплаты" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "refunded", settled: false });
  });

  it("мастер отменить не может — FORBIDDEN; двойная отмена — один REFUND", async () => {
    const f = await dealAt("PAID_HOLD", { provider: "manual" });
    await expect(cancelDeal(f.executor, { dealId: f.dealId }, noop)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const results = await Promise.allSettled([cancelDeal(f.client, { dealId: f.dealId }, noop), cancelDeal(f.client, { dealId: f.dealId }, noop)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.moneyTransaction.count({ where: { dealId: f.dealId, type: "REFUND" } })).toBe(1);
  });
});

describe("после начала работ — только через спор", () => {
  it.each(["IN_PROGRESS", "READY"] as const)("%s: отмена — CONFLICT, денег не трогаем", async (step) => {
    const f = await dealAt(step);
    await expect(cancelDeal(f.client, { dealId: f.dealId }, noop)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await journalOf(f.dealId)).map((t) => t.type)).toEqual(["HOLD"]);
  });
});
