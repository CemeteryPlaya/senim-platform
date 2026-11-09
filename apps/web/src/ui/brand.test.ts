import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS } from "./brand";

const css = readFileSync(path.join(__dirname, "tokens.css"), "utf8");
const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})\\s*;`, "i"))?.[1].toLowerCase();

describe("цвета бренда вне CSS", () => {
  it.each([
    ["primary", BRAND_COLORS.primary],
    ["canvas", BRAND_COLORS.canvas],
    ["surface", BRAND_COLORS.surface],
    ["ink", BRAND_COLORS.ink],
    ["muted", BRAND_COLORS.muted],
    ["line", BRAND_COLORS.line],
    ["on-primary", BRAND_COLORS.onPrimary],
  ])("совпадают с токеном --color-%s", (name, value) => {
    expect(value).toBe(token(name));
  });
});
