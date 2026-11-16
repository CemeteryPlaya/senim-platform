import { describe, expect, it } from "vitest";
import { LengthField } from "./LengthField";
import { html } from "./test-utils";
import { lengthNote, parseLengthCm } from "./length-logic";

describe("parseLengthCm", () => {
  it.each([
    ["240", 240],
    ["240 см", 240],
    ["240см", 240],
    ["240 cm", 240],
    ["2,4 м", 240],
    ["2.4 м", 240],
    ["2,4м", 240],
    ["2.4 m", 240],
    ["2 м", 200],
    ["2400 мм", 240],
    ["2 400 мм", 240],
    ["2400 mm", 240],
    ["2.4", 240],
    ["2,4", 240],
    ["0,6", 60],
    ["2400", 240],
    ["3600", 360],
    ["60,5", 61],
    ["60,5 см", 61],
    ["  240  ", 240],
    ["240 СМ", 240],
    ["2,4 М.", 240],
  ])("«%s» → %d см", (raw, cm) => {
    expect(parseLengthCm(raw)).toBe(cm);
  });

  it.each(["", "   ", "abc", "см", "2 м 40 см", "240 дюймов", "-5", "2,4,5", "1e3"])("«%s» — не длина", (raw) => {
    expect(parseLengthCm(raw)).toBeNull();
  });

  it("границы: сантиметры без единицы не трогаются до 2000, выше — миллиметры", () => {
    expect(parseLengthCm("2000")).toBe(2000);
    expect(parseLengthCm("2001")).toBe(200);
    expect(parseLengthCm("19,9")).toBe(1990);
    expect(parseLengthCm("20,5")).toBe(21);
  });
});

describe("lengthNote", () => {
  it("«= N см» только когда набрано не просто целое число сантиметров", () => {
    expect(lengthNote("240")).toBeNull();
    expect(lengthNote("2,4 м")).toBe(240);
    expect(lengthNote("240 см")).toBe(240);
    expect(lengthNote("abc")).toBeNull();
    expect(lengthNote("")).toBeNull();
  });
});

describe("LengthField", () => {
  const field = (value: string) => <LengthField label="Ширина" name="widthCm" value={value} onChange={() => {}} />;

  it("в форму уходят целые сантиметры; «см» в поле; клавиатура с запятой; имя — у скрытого поля", () => {
    const out = html(field("2,4 м"));
    expect(out).toMatch(/<input[^>]*type="hidden"[^>]*name="widthCm"[^>]*value="240"/);
    expect(out).toContain('inputMode="decimal"');
    expect(out).toContain('data-field="widthCm"');
    expect(out).toMatch(/<span aria-hidden="true"[^>]*>см<\/span>/);
    expect(out).toContain("= 240 см");
  });

  it("не длина — в форму как есть (схема скажет у поля), пояснения нет", () => {
    const out = html(field("abc"));
    expect(out).toMatch(/type="hidden"[^>]*name="widthCm"[^>]*value="abc"/);
    expect(out).not.toContain("= ");
  });
});
