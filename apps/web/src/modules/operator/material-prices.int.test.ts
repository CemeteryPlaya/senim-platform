import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../test/factories";
import { withFeature } from "../../../test/factories/companies";
import { setEnv } from "../../../test/factories/identity";
import { addMaterialPrice, changeMaterialPrice, listMaterialPrices, setMaterialPriceActive } from "./material-prices";
import { addMaterialPriceSchema, changeMaterialPriceSchema, type AddMaterialPriceInput } from "./schemas";

const LDSP: AddMaterialPriceInput = { category: "carcass", name: "ЛДСП 16 мм", unit: "m2", priceKzt: 4_500, segments: ["ECONOMY"] };

const audit = (action: string) => db.auditEvent.findMany({ where: { action }, orderBy: { seq: "asc" } });

// Справочник — за флагом materialsCalculator (ADR-009): в этом файле включён; выключенный — отдельный блок.
let prevFlag: string | undefined;
beforeAll(() => {
  prevFlag = process.env.FEATURE_MATERIALS_CALCULATOR;
  setEnv({ FEATURE_MATERIALS_CALCULATOR: "true" });
});
afterAll(() => setEnv({ FEATURE_MATERIALS_CALCULATOR: prevFlag }));

describe("справочник цен материалов: флаг materialsCalculator выключен", () => {
  it("список, добавление, смена цены и архив — FORBIDDEN, справочник не меняется", async () => {
    const operator = await makeOperator();
    const { id } = await addMaterialPrice(operator, LDSP);
    const forbidden = expect.objectContaining({ code: "FORBIDDEN" });
    await withFeature("materialsCalculator", false, async () => {
      await expect(listMaterialPrices(operator)).rejects.toEqual(forbidden);
      await expect(addMaterialPrice(operator, { ...LDSP, name: "МДФ 18 мм" })).rejects.toEqual(forbidden);
      await expect(changeMaterialPrice(operator, { id, from: 4_500, to: 5_000 })).rejects.toEqual(forbidden);
      await expect(setMaterialPriceActive(operator, { id, active: false })).rejects.toEqual(forbidden);
    });
    expect(await db.materialPrice.findMany({ select: { name: true, priceKzt: true, active: true } })).toEqual([{ name: "ЛДСП 16 мм", priceKzt: 4_500, active: true }]);
  });
});

describe("справочник цен материалов", () => {
  it("добавляет материал, показывает его в списке с автором и пишет аудит", async () => {
    const operator = await makeOperator();
    const { id } = await addMaterialPrice(operator, { ...LDSP, segments: ["ECONOMY", "COMFORT"] });

    const [row] = await listMaterialPrices(operator);
    expect(row).toMatchObject({ id, category: "carcass", name: "ЛДСП 16 мм", unit: "m2", priceKzt: 4_500, segments: ["ECONOMY", "COMFORT"], active: true, isDemo: false });
    expect(row.updatedBy).toBe(operator.fullName);
    const [event] = await audit("material_price.added");
    expect(event).toMatchObject({ entityType: "material_price", entityId: id, actorId: operator.id });
    expect(event.after).toMatchObject({ name: "ЛДСП 16 мм", priceKzt: 4_500 });
  });

  it("не добавляет тот же материал в той же категории и единице, в том числе если он в архиве", async () => {
    const operator = await makeOperator();
    const { id } = await addMaterialPrice(operator, LDSP);
    await expect(addMaterialPrice(operator, { ...LDSP, name: "лдсп 16 мм" })).rejects.toMatchObject({ code: "CONFLICT" });
    await setMaterialPriceActive(operator, { id, active: false });
    await expect(addMaterialPrice(operator, LDSP)).rejects.toMatchObject({ code: "CONFLICT" });
    // То же название в другой единице — другой материал.
    await expect(addMaterialPrice(operator, { ...LDSP, unit: "sheet", priceKzt: 23_000 })).resolves.toHaveProperty("id");
  });

  it("смена цены: аудит со старой и новой ценой, автор обновлён, пометка «демо» снимается", async () => {
    const operator = await makeOperator();
    const { id } = await addMaterialPrice(operator, LDSP);
    await db.materialPrice.update({ where: { id }, data: { isDemo: true, updatedById: null } });

    await changeMaterialPrice(operator, { id, from: 4_500, to: 5_200 });

    const [row] = await listMaterialPrices(operator);
    expect(row).toMatchObject({ priceKzt: 5_200, isDemo: false, updatedBy: operator.fullName });
    const [event] = await audit("material_price.price_changed");
    expect(event.before).toEqual({ priceKzt: 4_500, isDemo: true });
    expect(event.after).toEqual({ priceKzt: 5_200, isDemo: false });
  });

  it("двойной клик по «Сохранить» — одно изменение и одна запись в журнале", async () => {
    const operator = await makeOperator();
    const { id } = await addMaterialPrice(operator, LDSP);
    await Promise.all([changeMaterialPrice(operator, { id, from: 4_500, to: 5_000 }), changeMaterialPrice(operator, { id, from: 4_500, to: 5_000 })]);
    expect(await audit("material_price.price_changed")).toHaveLength(1);
  });

  it("цену уже изменил другой оператор — конфликт, а не перезапись", async () => {
    const operator = await makeOperator();
    const { id } = await addMaterialPrice(operator, LDSP);
    await changeMaterialPrice(operator, { id, from: 4_500, to: 5_000 });
    await expect(changeMaterialPrice(operator, { id, from: 4_500, to: 6_000 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await listMaterialPrices(operator))[0].priceKzt).toBe(5_000);
  });

  it("цену материала в архиве не меняет", async () => {
    const operator = await makeOperator();
    const { id } = await addMaterialPrice(operator, LDSP);
    await setMaterialPriceActive(operator, { id, active: false });
    await expect(changeMaterialPrice(operator, { id, from: 4_500, to: 5_000 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("в архив и обратно; повтор того же действия журнал не пишет", async () => {
    const operator = await makeOperator();
    const { id } = await addMaterialPrice(operator, LDSP);
    await setMaterialPriceActive(operator, { id, active: false });
    await setMaterialPriceActive(operator, { id, active: false });
    expect((await listMaterialPrices(operator))[0].active).toBe(false);
    await setMaterialPriceActive(operator, { id, active: true });
    expect((await db.auditEvent.findMany({ where: { entityId: id }, orderBy: { seq: "asc" } })).map((e) => e.action)).toEqual([
      "material_price.added",
      "material_price.archived",
      "material_price.restored",
    ]);
  });

  it("несуществующий материал — NOT_FOUND", async () => {
    const operator = await makeOperator();
    await expect(changeMaterialPrice(operator, { id: "nope", from: 1, to: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setMaterialPriceActive(operator, { id: "nope", active: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("каждое действие — только оператору", async () => {
    const operator = await makeOperator();
    const client = await makeClient();
    const { id } = await addMaterialPrice(operator, LDSP);
    await expect(listMaterialPrices(client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addMaterialPrice(client, { ...LDSP, name: "Другое" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeMaterialPrice(client, { id, from: 4_500, to: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setMaterialPriceActive(client, { id, active: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("вход форм справочника цен", () => {
  const form = { category: "facade", name: "МДФ эмаль", unit: "m2", priceKzt: "35 000", segment_COMFORT: "on", segment_PREMIUM: "on" };

  it("форма: цена с пробелами, уровни из флажков", () => {
    expect(addMaterialPriceSchema.parse(form)).toEqual({ category: "facade", name: "МДФ эмаль", unit: "m2", priceKzt: 35_000, segments: ["COMFORT", "PREMIUM"] });
  });

  it("без уровня, с нулевой или дробной ценой, с чужой категорией — ошибка своего поля", () => {
    const fieldOf = (input: Record<string, string>) => addMaterialPriceSchema.safeParse(input).error?.issues.map((i) => i.path[0]);
    expect(fieldOf({ ...form, segment_COMFORT: "", segment_PREMIUM: "" })).toEqual(["segments"]);
    expect(fieldOf({ ...form, priceKzt: "0" })).toEqual(["priceKzt"]);
    expect(fieldOf({ ...form, priceKzt: "12,5" })).toEqual(["priceKzt"]);
    expect(fieldOf({ ...form, category: "glass" })).toEqual(["category"]);
  });

  it("смена цены: новая цена с пробелами, та же цена — ошибка", () => {
    expect(changeMaterialPriceSchema.parse({ id: "m1", from: "4500", to: "5 200" })).toEqual({ id: "m1", from: 4_500, to: 5_200 });
    expect(changeMaterialPriceSchema.safeParse({ id: "m1", from: "4500", to: "4500" }).success).toBe(false);
  });
});
