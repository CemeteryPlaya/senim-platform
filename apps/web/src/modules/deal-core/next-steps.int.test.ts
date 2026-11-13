import { afterEach, describe, expect, it } from "vitest";
import { actingAs, makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { confirmPending, dealAt, makeDeal, signAct, type DealFixture } from "../../../test/factories/deal";
import { resetEnvCache } from "@/platform/env";
import { cancelDeal, getDealView, leaveReview, nextStepsOf, openDispute, payForDeal, processDealMoney } from "./index";

afterEach(() => {
  delete process.env.FEATURE_REVIEWS;
  resetEnvCache();
});

/** Лёгкое чтение даёт тот же `next`, что полный `getDealView`, — по каждому полю, для каждого смотрящего. */
async function expectSame(f: DealFixture, extra: Awaited<ReturnType<typeof makeOperator>>[] = []) {
  for (const viewer of [f.client, f.executor, ...extra]) {
    const full = (await getDealView(viewer, f.dealId)).next;
    const light = (await nextStepsOf(viewer, [f.dealId])).get(f.dealId);
    expect(light, `${viewer.role}`).toBeDefined();
    expect(light?.action).toBe(full.action);
    expect(light?.mine).toBe(full.mine);
  }
}

describe("nextStepsOf: тот же next, что у getDealView", () => {
  it("оферта не подписана / подписана, ждём оплаты", async () => {
    await expectSame(await makeDeal(), [await makeOperator()]);
    await expectSame(await dealAt("SIGNED"));
  });

  it("оплата в банке (manual): ждёт подтверждения", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(f.client, { dealId: f.dealId });
    await expectSame(f);
    expect((await nextStepsOf(f.client, [f.dealId])).get(f.dealId)?.action).toBe("waitPaymentConfirmation");
    await confirmPending(f.dealId, "HOLD");
    await expectSame(f);
  });

  it("оплачена, идут работы, сдана", async () => {
    await expectSame(await dealAt("PAID_HOLD"));
    await expectSame(await dealAt("IN_PROGRESS"));
    await expectSame(await dealAt("READY"));
  });

  it("открытый спор", async () => {
    const f = await dealAt("IN_PROGRESS");
    await openDispute(f.client, { dealId: f.dealId, reason: "OTHER", description: "Спор для проверки следующего шага" });
    await expectSame(f, [await makeOperator()]);
    expect((await nextStepsOf(f.client, [f.dealId])).get(f.dealId)?.action).toBe("waitDispute");
  });

  it("отмена и возврат", async () => {
    const cancelled = await dealAt("SIGNED");
    await cancelDeal(cancelled.client, { dealId: cancelled.dealId });
    await expectSame(cancelled);
    const afterPay = await dealAt("PAID_HOLD");
    await cancelDeal(afterPay.client, { dealId: afterPay.dealId });
    await expectSame(afterPay);
  });

  it("акт подписан: выплата и отзыв (флаг reviews)", async () => {
    process.env.FEATURE_REVIEWS = "true";
    resetEnvCache();
    const f = await dealAt("READY");
    await signAct(f.dealId);
    await expectSame(f);
    await processDealMoney(f.dealId);
    const full = await getDealView(f.client, f.dealId);
    expect(full.status).toBe("SPLIT_PAYOUT");
    expect((await nextStepsOf(f.client, [f.dealId])).get(f.dealId)).toEqual({ action: "leaveReview", mine: true });
    await leaveReview(f.client, { dealId: f.dealId, rating: 5 });
    await expectSame(f);
    expect((await nextStepsOf(f.client, [f.dealId])).get(f.dealId)?.action).toBe("done");
  });

  it("много сделок сразу: каждая со своим next", async () => {
    const client = await makeClient();
    const a = await dealAt("SIGNED", { client });
    const b = await dealAt("IN_PROGRESS", { client });
    const c = await makeDeal({ client });
    const got = await nextStepsOf(client, [a.dealId, b.dealId, c.dealId, a.dealId]);
    expect([...got.keys()].sort()).toEqual([a.dealId, b.dealId, c.dealId].sort());
    for (const f of [a, b, c]) expect(got.get(f.dealId)).toEqual((await getDealView(client, f.dealId)).next);
  });
});

describe("nextStepsOf: доступ", () => {
  it("чужие и несуществующие сделки молча пропускаются", async () => {
    const mine = await dealAt("SIGNED");
    const other = await dealAt("SIGNED");
    const got = await nextStepsOf(mine.client, [mine.dealId, other.dealId, "нет-такой"]);
    expect([...got.keys()]).toEqual([mine.dealId]);
    expect((await nextStepsOf(await makeClient(), [mine.dealId])).size).toBe(0);
    expect((await nextStepsOf(await makeExecutor(), [mine.dealId])).size).toBe(0);
    expect((await nextStepsOf(mine.client, [])).size).toBe(0);
  });

  it("сторона в другой роли — по активной роли (ADR-004)", async () => {
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    const f = await dealAt("SIGNED", { executor: both });
    expect((await nextStepsOf(actingAs(both, "CLIENT"), [f.dealId])).size).toBe(0);
    expect((await nextStepsOf(both, [f.dealId])).has(f.dealId)).toBe(true);
  });
});
