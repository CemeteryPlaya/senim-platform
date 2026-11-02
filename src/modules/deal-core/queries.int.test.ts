import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { actingAs, makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeDeal, signContract } from "../../../test/factories/deal";
import { dealPartyOf, getDealView, listDeals } from "./index";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

describe("экраны сделки: доступ и анонимность", () => {
  it("каждый видит только свои сделки, оператор — все", async () => {
    const a = await makeDeal();
    const b = await makeDeal();
    expect((await listDeals(a.client)).map((d) => d.id)).toEqual([a.dealId]);
    expect((await listDeals(b.executor)).map((d) => d.id)).toEqual([b.dealId]);
    expect(await listDeals(await makeClient())).toEqual([]);
    expect((await listDeals(await makeOperator())).map((d) => d.id).sort()).toEqual([a.dealId, b.dealId].sort());
  });

  it("человек с двумя ролями видит в списке сделки обеих ролей с пометкой, а открывает — только в своей роли", async () => {
    const person = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    const asExecutor = await makeDeal({ executor: person });
    const asClient = await makeDeal({ client: actingAs(person, "CLIENT") });
    await makeDeal();

    for (const viewer of [person, actingAs(person, "CLIENT")]) {
      const list = await listDeals(viewer);
      expect(list.map((d) => [d.id, d.myRole]).sort()).toEqual(
        [
          [asExecutor.dealId, "EXECUTOR"],
          [asClient.dealId, "CLIENT"],
        ].sort(),
      );
    }
    expect(await code(getDealView(person, asClient.dealId))).toBe("NOT_FOUND");
    expect(await code(getDealView(actingAs(person, "CLIENT"), asClient.dealId))).toBe("OK");
    expect(await dealPartyOf(person, asClient.dealId)).toBe("CLIENT");
    expect(await dealPartyOf(person, asExecutor.dealId)).toBe("EXECUTOR");
    expect(await dealPartyOf(await makeClient(), asClient.dealId)).toBeNull();
  });

  it("у оператора пометки роли нет", async () => {
    await makeDeal();
    expect((await listDeals(await makeOperator())).map((d) => d.myRole)).toEqual([null]);
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
    expect(view.executorAddress).toBe(profile.city);
    expect(json).not.toContain(profile.legalName);
    expect(json).not.toContain(profile.user.phone);
    expect(json).not.toContain(profile.binIinLast4 + '"');
    expect(view.viewer).toBe("CLIENT");
    expect(view.next.action).toMatchObject({ kind: "markPaid" });
  });

  it("режим «имя показано» (№6): наименование и полный адрес, но не телефон и не ИИН/БИН", async () => {
    const f = await makeDeal();
    await db.executorProfile.update({
      where: { id: f.executor.executor.id },
      data: { city: "Алматы", district: "Бостандыкский район", streetAddress: "ул. Тестовая, 1" },
    });
    process.env.DEMO_MODE = "true";
    resetEnvCache();
    await db.platformSetting.create({ data: { key: "companies.executorIdentity", value: "SHOWN" } });
    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: f.executor.executor.id }, include: { user: true } });

    const view = await getDealView(f.client, f.dealId);
    const json = JSON.stringify(view);

    expect(view.executorLabel).toBe(profile.legalName);
    expect(view.executorAddress).toBe("Алматы, Бостандыкский район, ул. Тестовая, 1");
    expect((await listDeals(f.client))[0]?.executorLabel).toBe(profile.legalName);
    expect(json).not.toContain(profile.user.phone);
    expect(json).not.toContain(profile.binIinEnc);
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

describe("«Мой заказ»: что заказано и когда готово", () => {
  it("детали и стиль заявки — как есть, срок и гарантия — из отклика, плановая готовность — от подписания", async () => {
    const f = await makeDeal();
    await db.request.update({ where: { id: f.requestId }, data: { style: "modern", details: { widthCm: 320, unknown: ["facade"] } } });

    const before = await getDealView(f.client, f.dealId);
    expect(before.plannedReadyAt).toBeNull();
    expect(before.subject).toEqual({ style: "modern", details: { widthCm: 320, unknown: ["facade"] }, typeSlug: null, roomPhotos: [] });
    expect([before.durationDays, before.warrantyMonths]).toEqual([30, 12]);

    await signContract(f.dealId);
    const after = await getDealView(f.executor, f.dealId);
    const signedAt = (await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).signedAt;
    expect(after.plannedReadyAt?.getTime()).toBe((signedAt?.getTime() ?? 0) + 30 * 24 * 60 * 60 * 1000);
  });
});
