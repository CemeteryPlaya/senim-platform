import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Пары «передний план / фон», которые реально встречаются в компонентах.
// Цвета берём из tokens.css — тот же источник, что и у интерфейса.

const tokens = parseColorTokens(readFileSync(path.join(__dirname, "tokens.css"), "utf8"));

function parseColorTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    out[match[1]] = match[2].toLowerCase();
  }
  return out;
}

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

function token(name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`нет токена --color-${name}`);
  return value;
}

/** Текст: WCAG AA для обычного текста. */
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["ink", "sunken"],
  ["ink-soft", "canvas"],
  ["ink-soft", "surface"],
  ["ink-soft", "sunken"],
  ["muted", "canvas"],
  ["muted", "surface"],
  ["muted", "sunken"],
  ["on-primary", "primary"],
  ["on-primary", "primary-hover"],
  ["on-primary", "danger"],
  ["on-primary", "danger-hover"],
  ["on-accent", "accent"],
  ["on-accent", "accent-hover"],
  ["accent", "canvas"],
  ["accent", "surface"],
  ["ink", "accent-soft"],
  ["accent", "accent-soft"],
  ["primary", "accent-soft"],
  ["primary-hover", "accent-soft-hover"], // кнопка soft при наведении темнеет целиком: и подложка, и текст
  ["muted", "accent-soft"],
  ["accent", "sunken"],
  ["info", "info-soft"],
  ["success", "success-soft"],
  ["warning", "warning-soft"],
  ["danger", "danger-soft"],
  ["danger", "surface"],
  ["danger", "canvas"],
  ["ink", "info-soft"],
  ["ink", "warning-soft"],
  ["ink", "danger-soft"],
  ["ink", "success-soft"],
  // Зелёный текст (text-primary / text-accent) на всех светлых фонах: ссылки «Смотреть все», активная вкладка,
  // мятные плашки и кнопка soft. В макете он светлее — здесь проверяем, что поднятый держит 4,5:1.
  ["primary", "canvas"],
  ["primary", "surface"],
  ["primary", "sunken"],
  ["accent-hover", "accent-soft-hover"],
  // Вторичный текст внутри цветных плашек и бейджей.
  ["muted", "info-soft"],
  ["muted", "success-soft"],
  ["muted", "warning-soft"],
  ["muted", "danger-soft"],
  // Блок денег на карточке сделки (ТЗ п. 4.1): строки под заголовком — ink-soft на сером, зелёном и жёлтом.
  ["ink-soft", "success-soft"],
  ["ink-soft", "warning-soft"],
  // v2: серый фон страницы и белые карточки (спека 4.1); «Новое» — янтарный бейдж.
  ["ink-soft", "canvas"],
  ["new", "new-soft"],
  ["ink", "new-soft"],
  ["muted", "new-soft"],
];

/** Нетекстовые элементы (границы полей, кольцо фокуса): WCAG 1.4.11 — 3:1. */
const UI_PAIRS: [fg: string, bg: string][] = [
  ["line-strong", "surface"],
  ["line-strong", "canvas"],
  ["focus", "canvas"],
  ["focus", "surface"],
  ["focus", "sunken"],
  ["line-strong", "sunken"],
  ["focus", "accent-soft"],
  ["line-strong", "new-soft"],
  // Заливка кнопки, выбранного чипа и пройденного шага видна на фоне (граница элемента — сама заливка).
  ["primary", "canvas"],
  ["primary", "surface"],
];

describe("контраст дизайн-токенов", () => {
  it("считает контраст по WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it.each(TEXT_PAIRS)("текст %s на %s — не ниже 4,5:1", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)("элемент %s на %s — не ниже 3:1", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });
});
