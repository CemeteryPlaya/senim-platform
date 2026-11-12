import { describe, expect, it } from "vitest";
import { type ColorRole, TOKENS } from "./tokens";

// Контраст пар «передний план / фон» по WCAG 2.x для обеих тем. Цвета — из TOKENS,
// а tokens.test.ts держит tokens.css равным TOKENS, так что проверяется то, что видит пользователь.

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Текст: WCAG AA для обычного текста — 4,5:1. */
const TEXT_PAIRS: [fg: ColorRole, bg: ColorRole][] = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["ink", "raised"],
  ["muted", "canvas"],
  ["muted", "surface"],
  ["muted", "raised"],
  ["on-action", "action"],
  ["accent", "surface"],
  ["accent", "canvas"],
  ["accent", "accent-soft"],
  ["danger", "surface"],
  ["danger", "danger-soft"],
  ["warn", "surface"],
  ["warn", "warn-soft"],
];

/** Нетекстовые элементы (кольцо фокуса): WCAG 1.4.11 — 3:1. */
const UI_PAIRS: [fg: ColorRole, bg: ColorRole][] = [
  ["focus", "canvas"],
  ["focus", "surface"],
];

const THEMES = ["light", "dark"] as const;
const cases = (pairs: [ColorRole, ColorRole][]) => THEMES.flatMap((theme) => pairs.map(([fg, bg]) => [theme, fg, bg] as const));

describe("контраст токенов двух тем", () => {
  it("считает контраст по WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it.each(cases(TEXT_PAIRS))("%s: текст %s на %s — не ниже 4,5:1", (theme, fg, bg) => {
    expect(contrast(TOKENS[theme][fg], TOKENS[theme][bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases(UI_PAIRS))("%s: элемент %s на %s — не ниже 3:1", (theme, fg, bg) => {
    expect(contrast(TOKENS[theme][fg], TOKENS[theme][bg])).toBeGreaterThanOrEqual(3);
  });
});
