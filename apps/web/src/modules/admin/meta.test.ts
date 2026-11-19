import { describe, expect, it } from "vitest";
import { listSelect, modelMeta, navigationOf, recordSelect, relationsOf, scalarFields } from "./meta";
import { fieldAccess } from "./rules";
import { ADMIN_MODELS } from "./schema.gen";

/**
 * Все пути `модель.поле` в select (вложенные select связей — по правилам связанной модели), кроме служебного `_count`.
 * Скрытое поле в любом из них — утечка: оно ушло бы из базы в ответ.
 */
function selectedPaths(model: string, select: Readonly<Record<string, unknown>>): { model: string; field: string }[] {
  const out: { model: string; field: string }[] = [];
  for (const [key, value] of Object.entries(select)) {
    if (key === "_count") {
      const counted = (value as { select: Record<string, true> }).select;
      for (const rel of Object.keys(counted)) out.push({ model, field: rel });
      continue;
    }
    out.push({ model, field: key });
    if (typeof value === "object" && value !== null) {
      const target = modelMeta(model)?.fields.find((f) => f.name === key)?.type;
      expect(target, `${model}.${key}`).toBeDefined();
      out.push(...selectedPaths(target ?? "", (value as { select: Record<string, unknown> }).select));
    }
  }
  return out;
}

describe("select админки строится только из видимых полей", () => {
  it.each(ADMIN_MODELS.map((m) => m.name))("%s: список и карточка не выбирают скрытых полей, в том числе через связи", (model) => {
    for (const select of [listSelect(model), recordSelect(model)]) {
      for (const p of selectedPaths(model, select)) expect(fieldAccess(p.model, p.field), `${p.model}.${p.field}`).not.toBe("hidden");
    }
  });

  it("User: связь sessions — только число, ExecutorProfile.user — только id пользователя", () => {
    const user = recordSelect("User");
    expect(user).not.toHaveProperty("sessions");
    expect(user._count).toEqual({ select: expect.objectContaining({ sessions: true }) });
    expect(user).not.toHaveProperty("iinHash");
    expect(recordSelect("ExecutorProfile").user).toEqual({ select: { id: true } });
    expect(recordSelect("Session").user).toEqual({ select: { id: true } });
    expect(recordSelect("Session")).not.toHaveProperty("tokenHash");
  });

  it("список — только скалярные видимые поля", () => {
    expect(Object.keys(listSelect("ExecutorProfile"))).toEqual(scalarFields("ExecutorProfile").map((f) => f.name));
    expect(scalarFields("ExecutorProfile").map((f) => f.name)).not.toEqual(expect.arrayContaining(["binIinHash"]));
    expect(scalarFields("ExecutorProfile").every((f) => f.kind !== "object")).toBe(true);
  });

  it("неизвестная модель — пустой выбор, без исключения", () => {
    expect(modelMeta("toString")).toBeUndefined();
    expect(modelMeta("Nope")).toBeUndefined();
    expect(scalarFields("Nope")).toEqual([]);
  });
});

describe("связи", () => {
  const rel = (model: string, name: string) => relationsOf(model).find((r) => r.name === name);

  it("«один»: Deal.client — пользователь по id; обратная сторона без FK (User.executorProfile) — тоже «один»", () => {
    expect(rel("Deal", "client")).toEqual({ name: "client", model: "User", kind: "one", idField: "id" });
    expect(rel("User", "executorProfile")).toEqual({ name: "executorProfile", model: "ExecutorProfile", kind: "one", idField: "id" });
  });

  it("«много»: переход по внешнему ключу связанной модели, несколько связей между моделями различаются по имени", () => {
    expect(rel("Request", "offers")).toEqual({ name: "offers", model: "Offer", kind: "many", field: "requestId" });
    expect(rel("User", "disputesOpened")).toMatchObject({ model: "Dispute", field: "openedById" });
    expect(rel("User", "disputesResolved")).toMatchObject({ model: "Dispute", field: "resolvedById" });
    expect(rel("MoneyTransaction", "children")).toMatchObject({ model: "MoneyTransaction", field: "parentId" });
  });

  it("«много ко многим» без внешнего ключа: переход по обратной связи", () => {
    expect(rel("ExecutorProfile", "specializations")).toEqual({ name: "specializations", model: "FurnitureType", kind: "many", field: "executors" });
    expect(navigationOf("FurnitureType", "executors")).toEqual({ kind: "some", idField: "id" });
  });

  it("у каждой связи «много» любой модели есть переход, и связанная таблица его принимает", () => {
    for (const model of ADMIN_MODELS) {
      const lists = model.fields.filter((f) => f.kind === "object" && f.list && fieldAccess(model.name, f.name) !== "hidden");
      for (const list of lists) {
        const r = rel(model.name, list.name);
        expect(r, `${model.name}.${list.name}`).toMatchObject({ kind: "many" });
        if (r?.kind !== "many") continue;
        expect(navigationOf(r.model, r.field), `${model.name}.${list.name} → ${r.model}.${r.field}`).not.toBeNull();
      }
    }
  });

  it("переход только по видимому внешнему ключу или связи: скрытое, обычное и неизвестное поле — нет", () => {
    expect(navigationOf("Offer", "requestId")).toEqual({ kind: "fk" });
    expect(navigationOf("User", "iinHash")).toBeNull();
    expect(navigationOf("Offer", "status")).toBeNull();
    expect(navigationOf("Offer", "nope")).toBeNull();
    expect(navigationOf("Nope", "id")).toBeNull();
  });
});
