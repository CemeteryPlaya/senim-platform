import { describe, expect, it } from "vitest";
import { parseDraftSuggestion, toDraft, type RequestDraftSuggestion } from "./schema";

const valid: RequestDraftSuggestion = {
  furnitureTypeSlug: "kitchen",
  customType: null,
  style: "modern",
  widthCm: 320,
  heightCm: 270,
  depthCm: 60,
  facade: "mdf_enamel",
  countertop: "compact",
  hardware: "soft_close",
  color: "Шалфей и светлый дуб",
  unknown: [],
  wishes: "Нужна подсветка",
};

describe("parseDraftSuggestion — ответ провайдера проверяется схемой", () => {
  it("принимает корректный ответ", () => {
    expect(parseDraftSuggestion(valid)).toEqual({ ok: true, suggestion: valid });
  });

  it("лишние поля отбрасываются, а не ломают разбор", () => {
    const r = parseDraftSuggestion({ ...valid, price: 100_000 });
    expect(r.ok && "price" in r.suggestion).toBe(false);
    expect(r.ok).toBe(true);
  });

  it.each([
    ["не объект", "кухня 3 метра"],
    ["null", null],
    ["размер строкой", { ...valid, widthCm: "320 см" }],
    ["отрицательный размер", { ...valid, widthCm: -5 }],
    ["размер больше 20 м", { ...valid, widthCm: 2001 }],
    ["дробный размер", { ...valid, heightCm: 270.5 }],
    ["материал не из справочника", { ...valid, facade: "plywood" }],
    ["столешница не из справочника", { ...valid, countertop: "granite" }],
    ["стиль не из справочника", { ...valid, style: "baroque" }],
    ["неизвестное «не знаю»", { ...valid, unknown: ["price"] }],
    ["нет обязательного поля", { ...valid, hardware: undefined }],
    ["слишком длинные пожелания", { ...valid, wishes: "а".repeat(301) }],
    ["слишком длинный свой тип", { ...valid, customType: "а".repeat(81) }],
  ])("отклоняет кривой ответ: %s", (_name, raw) => {
    expect(parseDraftSuggestion(raw).ok).toBe(false);
  });
});

describe("toDraft — перенос в формат details заявки", () => {
  it("кладёт размеры и материалы в details с ключами сида, пустые поля опускает", () => {
    const draft = toDraft(
      { ...valid, depthCm: null, countertop: null, color: null, unknown: ["countertop"] },
      ["kitchen", "wardrobe"],
    );
    expect(draft).toEqual({
      furnitureTypeSlug: "kitchen",
      customType: null,
      style: "modern",
      details: { widthCm: 320, heightCm: 270, facade: "mdf_enamel", hardware: "soft_close", unknown: ["countertop"] },
      wishes: "Нужна подсветка",
    });
  });

  it("тип мебели не из справочника оператора не переносится", () => {
    const draft = toDraft({ ...valid, furnitureTypeSlug: "spaceship" }, ["kitchen"]);
    expect(draft.furnitureTypeSlug).toBeNull();
  });

  it("«не знаю» для заполненного поля отбрасывается: черновик проходит проверку заявки", () => {
    const draft = toDraft({ ...valid, unknown: ["size", "facade", "countertop"], countertop: null }, ["kitchen"]);
    expect(draft.details.unknown).toEqual(["countertop"]);
  });

  it("пустой список «не знаю» не попадает в details", () => {
    expect(toDraft(valid, ["kitchen"]).details).not.toHaveProperty("unknown");
  });
});
