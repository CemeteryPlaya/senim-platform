import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeDeal, signContract } from "../../../test/factories/deal";
import { getDealView, listDeals } from "./index";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

describe("экраны сделки: доступ и анонимность", () => {
  it("каждый видит только свои сделки, оператор — все", async () => {
    const a = await makeDeal();
    const b = await makeDeal();
    expect((await listDeals(a.client)).map((d) => d.id)).toEqual([a.dealId]);
    expect((await listDeals(b.executor)).map((d) => d.id)).toEqual([b.dealId]);
    expect(await listDeals(await makeClient())).toEqual([]);
    expect((await listDeals(await makeOperator())).map((d) => d.id).sort()).toEqual([a.dealId, b.dealId].sort());
  });

  it("чужая сделка — «не найдено» для заказчика и исполнителя", async () => {
    const f = await makeDeal();
    expect(await code(getDealView(await makeClient(), f.dealId))).toBe("NOT_FOUND");
    expect(await code(getDealView(await makeExecutor(), f.dealId))).toBe("NOT_FOUND");
    expect(await code(getDealView(await makeOperator(), f.dealId))).toBe("OK");
  });

  it("заказчик видит «Исполнитель №N» — без наименования, ИИН/БИН и телефона", async () => {
    const f = await makeDeal();
    await signContract(f.dealId);
    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: f.executor.executor.id }, include: { user: true } });
    const view = await getDealView(f.client, f.dealId);
    const json = JSON.stringify(view);

    expect(view.executorLabel).toBe(`Исполнитель №${profile.publicNumber}`);
    expect(json).not.toContain(profile.legalName);
    expect(json).not.toContain(profile.user.phone);
    expect(json).not.toContain(profile.binIinLast4 + '"');
    expect(view.viewer).toBe("CLIENT");
    expect(view.next.action).toMatchObject({ kind: "markPaid" });
  });

  it("история сделки собрана из журнала аудита по порядку", async () => {
    const f = await makeDeal();
    await signContract(f.dealId);
    const view = await getDealView(f.executor, f.dealId);
    const actions = view.history.map((h) => h.action);
    expect(actions[0]).toBe("deal.created");
    expect(actions.indexOf("deal.signed")).toBeGreaterThan(0);
  });
});
