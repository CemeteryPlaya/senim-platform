import { afterEach, describe, expect, it } from "vitest";
import { dealAt, dealOf, signAct } from "../../../test/factories/deal";
import { resetEnvCache } from "@/platform/env";
import { processDealMoney } from "./money";
import { getPublicDealView, grantPublicConsent, revokePublicConsent } from "./public-view";

function showcase(on: boolean) {
  process.env.FEATURE_PUBLIC_SHOWCASE = on ? "true" : "false";
  resetEnvCache();
}

async function completedDeal() {
  const f = await dealAt("READY");
  await signAct(f.dealId);
  await processDealMoney(f.dealId);
  expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
  return f;
}

afterEach(() => showcase(false));

describe("публичная витрина сделки (фундамент, ТЗ п. 8)", () => {
  it("publicId выдаётся только после согласия обеих сторон", async () => {
    const f = await completedDeal();
    expect(await grantPublicConsent(f.client, { dealId: f.dealId })).toEqual({ publicId: null });
    const { publicId } = await grantPublicConsent(f.executor, { dealId: f.dealId });
    expect(publicId).toMatch(/^[\w-]{12,}$/);
  });

  it("при выключенном флаге витрина не открывается, при включённом — обезличенная проекция", async () => {
    const f = await completedDeal();
    await grantPublicConsent(f.client, { dealId: f.dealId });
    const { publicId } = await grantPublicConsent(f.executor, { dealId: f.dealId });
    showcase(false);
    expect(await getPublicDealView(publicId!)).toBeNull();
    showcase(true);
    const view = await getPublicDealView(publicId!);
    expect(view).toMatchObject({ publicId, status: "SPLIT_PAYOUT" });
    expect(view!.money.map((m) => m.type)).toContain("HOLD");
    const text = JSON.stringify(view, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    for (const secret of [f.client.phone, f.executor.phone, f.client.id, f.executor.id, f.dealId]) expect(text).not.toContain(secret);
  });

  it("отзыв согласия одной стороной закрывает витрину", async () => {
    const f = await completedDeal();
    await grantPublicConsent(f.client, { dealId: f.dealId });
    const { publicId } = await grantPublicConsent(f.executor, { dealId: f.dealId });
    showcase(true);
    await revokePublicConsent(f.client, { dealId: f.dealId });
    expect(await getPublicDealView(publicId!)).toBeNull();
  });

  it("незавершённая сделка на витрину не попадает", async () => {
    const f = await dealAt("IN_PROGRESS");
    await grantPublicConsent(f.client, { dealId: f.dealId });
    const { publicId } = await grantPublicConsent(f.executor, { dealId: f.dealId });
    showcase(true);
    expect(await getPublicDealView(publicId!)).toBeNull();
  });

  it("чужой человек согласие дать не может", async () => {
    const f = await completedDeal();
    const other = await dealAt("SIGNED");
    await expect(grantPublicConsent(other.client, { dealId: f.dealId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
