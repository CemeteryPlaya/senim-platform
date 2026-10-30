import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { makeOffer, makeRequest } from "../../../test/factories/operator";
import { addFurnitureType, listFurnitureTypes, moveFurnitureType, renameFurnitureType, setFurnitureTypeActive } from "./furniture-types";
import { listStaleRequests } from "./requests";

describe("справочник типов мебели", () => {
  it("добавляет тип в конец списка с уникальным slug и пишет аудит", async () => {
    const operator = await makeOperator();
    await addFurnitureType(operator, { name: "Кухня" });
    await addFurnitureType(operator, { name: "Мебель для балкона" });

    const types = await listFurnitureTypes(operator);
    expect(types.map((t) => t.name)).toEqual(["Кухня", "Мебель для балкона"]);
    expect(types[1].slug).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(types.map((t) => t.slug)).size).toBe(2);
    expect(await db.auditEvent.count({ where: { action: "furniture_type.added" } })).toBe(2);
  });

  it("не добавляет тип с тем же названием", async () => {
    const operator = await makeOperator();
    await addFurnitureType(operator, { name: "Кухня" });
    await expect(addFurnitureType(operator, { name: "кухня" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("переименовывает, скрывает и меняет порядок", async () => {
    const operator = await makeOperator();
    const a = await addFurnitureType(operator, { name: "Кухня" });
    const b = await addFurnitureType(operator, { name: "Шкаф" });

    await renameFurnitureType(operator, { id: b.id, name: "Шкаф-купе" });
    await setFurnitureTypeActive(operator, { id: a.id, active: false });
    await moveFurnitureType(operator, { id: b.id, direction: "up" });

    const types = await listFurnitureTypes(operator);
    expect(types.map((t) => [t.name, t.active])).toEqual([
      ["Шкаф-купе", true],
      ["Кухня", false],
    ]);
    const actions = (await db.auditEvent.findMany({ orderBy: { seq: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["furniture_type.added", "furniture_type.added", "furniture_type.renamed", "furniture_type.hidden", "furniture_type.moved"]);
  });

  it("крайний тип дальше края не двигает", async () => {
    const operator = await makeOperator();
    const a = await addFurnitureType(operator, { name: "Кухня" });
    await moveFurnitureType(operator, { id: a.id, direction: "up" });
    expect((await listFurnitureTypes(operator)).map((t) => t.name)).toEqual(["Кухня"]);
    expect(await db.auditEvent.count({ where: { action: "furniture_type.moved" } })).toBe(0);
  });
});

describe("заявки без откликов", () => {
  it("показывает открытые заявки старше порога без активных откликов", async () => {
    const operator = await makeOperator();
    const stale = await makeRequest({ publishedHoursAgo: 30 });
    const withOffer = await makeRequest({ publishedHoursAgo: 30 });
    await makeOffer(withOffer.id);
    const withDeclined = await makeRequest({ publishedHoursAgo: 48 });
    await makeOffer(withDeclined.id, { status: "DECLINED" });
    await makeRequest({ publishedHoursAgo: 2 });
    await makeRequest({ status: "CANCELLED", publishedHoursAgo: 50 });

    const rows = await listStaleRequests(operator, { hours: 24 });

    expect(rows.map((r) => r.id)).toEqual([withDeclined.id, stale.id]);
    expect(rows[0]).toMatchObject({ declinedOffers: 1, waitingHours: 48 });
  });
});
