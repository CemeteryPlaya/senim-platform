import { describe, expect, it } from "vitest";
import type { AdminField } from "./schema-parse";
import { serializeRow, serializeValue } from "./values";

const f = (type: string, extra: Partial<AdminField> = {}): AdminField => ({
  name: "x",
  kind: "scalar",
  type,
  required: true,
  list: false,
  id: false,
  updatedAt: false,
  hasDefault: false,
  relationFields: [],
  ...extra,
});

describe("serializeValue: значение базы → значение для экрана", () => {
  it("BigInt — строка цифр без потери точности (тиыны)", () => {
    expect(serializeValue(f("BigInt"), 9_007_199_254_740_993n)).toBe("9007199254740993");
    expect(serializeValue(f("BigInt"), -1n)).toBe("-1");
  });

  it("DateTime — ISO 8601 в UTC; неверная дата — null", () => {
    expect(serializeValue(f("DateTime"), new Date("2026-11-20T10:11:12.345Z"))).toBe("2026-11-20T10:11:12.345Z");
    expect(serializeValue(f("DateTime"), new Date(Number.NaN))).toBeNull();
  });

  it("Json — JSON-строка (и строка, и число, и объект); null базы — null", () => {
    expect(serializeValue(f("Json"), { a: 1, b: [true, null] })).toBe('{"a":1,"b":[true,null]}');
    expect(serializeValue(f("Json"), "текст")).toBe('"текст"');
    expect(serializeValue(f("Json"), 5)).toBe("5");
    expect(serializeValue(f("Json"), null)).toBeNull();
  });

  it("строки, числа, булевы и перечисления — как есть", () => {
    expect(serializeValue(f("String"), "Кухня")).toBe("Кухня");
    expect(serializeValue(f("Int"), 42)).toBe(42);
    expect(serializeValue(f("Float"), 4.5)).toBe(4.5);
    expect(serializeValue(f("Boolean"), false)).toBe(false);
    expect(serializeValue(f("DealStatus", { kind: "enum" }), "PAID_HOLD")).toBe("PAID_HOLD");
  });

  it("Decimal — строкой; Bytes — base64", () => {
    const decimal = { toString: () => "12.50", toFixed: () => "12.50" };
    expect(serializeValue(f("Decimal"), decimal)).toBe("12.50");
    expect(serializeValue(f("Bytes"), new Uint8Array([1, 2, 255]))).toBe("AQL/");
  });

  it("списки — массив строк (числа и перечисления — строкой)", () => {
    expect(serializeValue(f("Role", { kind: "enum", list: true }), ["CLIENT", "EXECUTOR"])).toEqual(["CLIENT", "EXECUTOR"]);
    expect(serializeValue(f("Int", { list: true }), [1, 2])).toEqual(["1", "2"]);
    expect(serializeValue(f("BigInt", { list: true }), [10n])).toEqual(["10"]);
  });

  it("нет значения — null; число вне конечных (NaN) — null", () => {
    expect(serializeValue(f("String", { required: false }), null)).toBeNull();
    expect(serializeValue(f("String"), undefined)).toBeNull();
    expect(serializeValue(f("Float"), Number.NaN)).toBeNull();
  });
});

describe("serializeRow", () => {
  it("берёт только перечисленные поля, лишние ключи записи в строку не попадают", () => {
    const fields = [f("String", { name: "name" }), f("BigInt", { name: "priceTiyn" })];
    const row = serializeRow(fields, { name: "Кухня", priceTiyn: 100n, iinHash: "секрет" });
    expect(row).toEqual({ name: "Кухня", priceTiyn: "100" });
    expect(JSON.stringify(row)).not.toContain("секрет");
  });
});
