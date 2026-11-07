import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { confirmPending, dealAt, signAct } from "../../../test/factories/deal";
import { getBankDemo } from "./bank-demo";

function setDemoMode(on: boolean) {
  process.env.DEMO_MODE = on ? "true" : "false";
  resetEnvCache();
}

afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

/** Демо-персоны: под ними входят из /demo, поэтому шаги показа берут только их. */
async function demoParties() {
  const client = await makeClient("Айгерим");
  const executor = await makeExecutor();
  const operator = await makeOperator("Динара");
  await db.user.updateMany({ where: { id: { in: [client.id, executor.id, operator.id] } }, data: { isDemo: true } });
  return { client, executor, operator };
}

describe("страница показа банку", () => {
  it("без DEMO_MODE недоступна", async () => {
    setDemoMode(false);
    await expect(getBankDemo({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ведёт по шагам одной сделки на manual под нужной персоной: оплату и выплату проводит оператор", async () => {
    setDemoMode(true);
    const { client, executor, operator } = await demoParties();
    const signed = await dealAt("SIGNED", { provider: "manual", client, executor });
    const ready = await dealAt("READY", { provider: "manual", client, executor });
    const accepted = await dealAt("READY", { provider: "manual", client, executor });
    await signAct(accepted.dealId);

    const demo = await getBankDemo({});

    const step = Object.fromEntries(demo.steps.map((s) => [s.key, s]));
    expect(step.request).toMatchObject({ href: "/requests/new", persona: { userId: client.id, role: "CLIENT" } });
    expect(step.payment).toMatchObject({ href: `/operator/deals/${signed.dealId}`, persona: { userId: operator.id, role: "OPERATOR" } });
    expect(step.act).toMatchObject({ href: `/deals/${ready.dealId}`, persona: { userId: client.id, role: "CLIENT" } });
    expect(step.payout).toMatchObject({ href: `/operator/deals/${accepted.dealId}`, persona: { userId: operator.id } });
    expect(step.closing).toMatchObject({ href: null });
  });

  it("сделка для разбора: журнал денег с документом банка, документы с хэшами, журнал аудита", async () => {
    setDemoMode(true);
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    for (const type of ["RELEASE", "SPLIT_MASTER", "SPLIT_PLATFORM"] as const) await confirmPending(f.dealId, type);
    const { number } = await db.deal.update({ where: { id: f.dealId }, data: { isDemo: true }, select: { number: true } });

    const demo = await getBankDemo({});

    expect(demo.selected?.card.deal).toMatchObject({ id: f.dealId, status: "SPLIT_PAYOUT", provider: "MANUAL" });
    expect(demo.selected?.card.journal.map((r) => [r.type, r.status])).toEqual([
      ["HOLD", "SUCCEEDED"],
      ["RELEASE", "SUCCEEDED"],
      ["SPLIT_MASTER", "SUCCEEDED"],
      ["SPLIT_PLATFORM", "SUCCEEDED"],
    ]);
    expect(demo.selected?.card.journal.every((r) => r.bankDocNumber !== null)).toBe(true);
    expect(demo.selected?.card.documents.map((d) => d.kind)).toEqual(expect.arrayContaining(["CONTRACT", "ACCEPTANCE_ACT"]));
    expect(demo.selected?.card.documents.every((d) => /^[0-9a-f]{64}$/.test(d.sha256))).toBe(true);
    expect(demo.selected?.history.map((e) => e.action)).toEqual(expect.arrayContaining(["payment.operation.confirmed"]));
    expect(demo.deals.map((d) => d.number)).toContain(number);

    expect((await getBankDemo({ deal: 999_999 })).selected).toBeNull();
  });

  it("настоящая (не тестовая) сделка на страницу не попадает — ни в список, ни по номеру", async () => {
    setDemoMode(true);
    const real = await dealAt("READY", { provider: "manual" });
    const { number } = await db.deal.findUniqueOrThrow({ where: { id: real.dealId }, select: { number: true } });

    const demo = await getBankDemo({});
    expect(demo.deals.map((d) => d.number)).not.toContain(number);
    expect(demo.selected).toBeNull();
    expect((await getBankDemo({ deal: number })).selected).toBeNull();
  });
});
