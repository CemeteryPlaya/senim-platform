import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { parseFieldValue, sameValue } from "./parse";
import type { AdminField } from "./schema-parse";

const t = ru.app.admin.record.errors;

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
const optional = (type: string, extra: Partial<AdminField> = {}) => f(type, { required: false, ...extra });

describe("parseFieldValue: строка формы → значение поля по типу схемы", () => {
  it("String — как есть, без обрезки; пустое у необязательного — null, у обязательного — «заполните»", () => {
    expect(parseFieldValue(f("String"), "  Кухня ", "to")).toEqual({ ok: true, value: "  Кухня " });
    expect(parseFieldValue(optional("String"), "", "to")).toEqual({ ok: true, value: null });
    expect(parseFieldValue(optional("String"), null, "to")).toEqual({ ok: true, value: null });
    expect(parseFieldValue(f("String"), "", "to")).toEqual({ ok: false, error: t.required });
    expect(parseFieldValue(f("String"), null, "to")).toEqual({ ok: false, error: t.required });
  });

  it("прежнее значение обязательной строки может быть пустым (поле с default \"\"), но не null", () => {
    expect(parseFieldValue(f("String"), "", "from")).toEqual({ ok: true, value: "" });
    expect(parseFieldValue(f("String"), null, "from")).toEqual({ ok: false, error: t.required });
  });

  it("Int — целое в пределах int32", () => {
    expect(parseFieldValue(f("Int"), "42", "to")).toEqual({ ok: true, value: 42 });
    expect(parseFieldValue(f("Int"), "-2147483648", "to")).toEqual({ ok: true, value: -2147483648 });
    expect(parseFieldValue(f("Int"), "2147483647", "to")).toEqual({ ok: true, value: 2147483647 });
    for (const bad of ["2147483648", "-2147483649", "1.5", "1e3", "abc", " 1", "0x10", "99999999999999999999"]) {
      expect(parseFieldValue(f("Int"), bad, "to"), bad).toEqual({ ok: false, error: t.int });
    }
    expect(parseFieldValue(optional("Int"), "", "to")).toEqual({ ok: true, value: null });
    expect(parseFieldValue(f("Int"), "", "to")).toEqual({ ok: false, error: t.required });
  });

  it("Boolean — только \"true\"/\"false\"", () => {
    expect(parseFieldValue(f("Boolean"), "true", "to")).toEqual({ ok: true, value: true });
    expect(parseFieldValue(f("Boolean"), "false", "to")).toEqual({ ok: true, value: false });
    for (const bad of ["1", "да", "TRUE", "on"]) expect(parseFieldValue(f("Boolean"), bad, "to")).toEqual({ ok: false, error: t.boolean });
  });

  it("перечисление — только значение из схемы", () => {
    const terms = f("MeasurementTerms", { kind: "enum" });
    expect(parseFieldValue(terms, "FREE", "to")).toEqual({ ok: true, value: "FREE" });
    expect(parseFieldValue(terms, "free", "to")).toEqual({ ok: false, error: t.enumValue });
    expect(parseFieldValue(f("Nope", { kind: "enum" }), "A", "to")).toEqual({ ok: false, error: t.enumValue });
  });

  it("DateTime — ISO 8601 с часовым поясом", () => {
    expect(parseFieldValue(f("DateTime"), "2026-11-20T10:11:12.345Z", "to")).toEqual({ ok: true, value: new Date("2026-11-20T10:11:12.345Z") });
    expect(parseFieldValue(f("DateTime"), "2026-11-20T15:11:12+05:00", "to")).toEqual({ ok: true, value: new Date("2026-11-20T10:11:12Z") });
    for (const bad of ["2026-11-20", "2026-11-20T10:11", "20.11.2026", "2026-13-01T00:00:00Z", "2026-02-31T00:00:00Z", "2026-11-20T24:00:00Z", "2026-11-20T10:60:00Z", "завтра"]) {
      expect(parseFieldValue(f("DateTime"), bad, "to"), bad).toEqual({ ok: false, error: t.dateTime });
    }
  });

  it("прочие типы (BigInt, Json, Float, списки) — FORBIDDEN: их нельзя править", () => {
    for (const field of [f("BigInt"), f("Json"), f("Float"), f("String", { list: true }), f("User", { kind: "object" })]) {
      expect(() => parseFieldValue(field, "1", "to")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    }
  });
});

describe("sameValue", () => {
  it("даты — по времени, остальное — строго", () => {
    expect(sameValue(new Date("2026-11-20T10:00:00Z"), new Date("2026-11-20T15:00:00+05:00"))).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue("1", 1)).toBe(false);
    expect(sameValue(null, "")).toBe(false);
  });
});
