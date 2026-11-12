import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_ROLES, TOKENS } from "./tokens";

// tokens.css и tokens.ts — одна палитра в двух местах: CSS нужен Tailwind, TS — тестам и метаданным.
// Тест держит их равными и не даёт цвету появиться в CSS мимо TOKENS.

const css = readFileSync(path.join(__dirname, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Тело первого блока, чей селектор совпадает с `selector` целиком (вложенные блоки не поддерживаются). */
function block(source: string, selector: RegExp): string {
  const match = new RegExp(String.raw`(?:^|[\n}])\s*` + selector.source + String.raw`\s*\{([^{}]*)\}`).exec(source);
  if (!match) throw new Error(`нет блока ${selector.source}`);
  return match[1];
}

/** Объявления вида `--role-<имя>: #rrggbb;` в блоке. */
function roleValues(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--role-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const darkMedia = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

const BLOCKS = {
  "светлая, :root": { body: () => block(css, /:root/), theme: TOKENS.light },
  'тёмная, [data-theme="dark"]': { body: () => block(css, /\[data-theme="dark"\]/), theme: TOKENS.dark },
  "тёмная по системе": { body: () => block(darkMedia, /:root:not\(\[data-theme="light"\]\)/), theme: TOKENS.dark },
};

describe("tokens.css совпадает с TOKENS", () => {
  it("в обеих темах одни и те же роли", () => {
    expect(Object.keys(TOKENS.light).sort()).toEqual([...COLOR_ROLES].sort());
    expect(Object.keys(TOKENS.dark).sort()).toEqual([...COLOR_ROLES].sort());
  });

  it.each(Object.entries(BLOCKS))("%s: каждая роль с тем же hex и без лишних", (_name, { body, theme }) => {
    expect(roleValues(body())).toEqual(theme);
  });

  it.each(Object.entries(BLOCKS))("%s: color-scheme соответствует теме", (name, { body }) => {
    const scheme = name.startsWith("светлая") ? "light" : "dark";
    expect(body()).toMatch(new RegExp(String.raw`color-scheme:\s*${scheme}\s*;`));
  });

  it.each(Object.entries(BLOCKS))("%s: цвет тени --shade задан и тёмный в обеих темах", (name, { body }) => {
    // В светлой теме тень — от почти чёрного ink; в тёмной ink светлый, поэтому тень берёт чёрный canvas.
    const role = name.startsWith("светлая") ? "ink" : "canvas";
    expect(body()).toMatch(new RegExp(String.raw`--shade:\s*var\(--role-${role}\)\s*;`));
  });

  it.each(Object.entries(BLOCKS))("%s: прозрачность затемнения --scrim-opacity задана", (_name, { body }) => {
    expect(body()).toMatch(/--scrim-opacity:\s*\d+%\s*;/);
  });

  it("затемнение при prefers-reduced-transparency сплошное", () => {
    const scrim = /@utility scrim\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(scrim).toContain("var(--scrim-opacity)");
    expect(scrim).toMatch(/@media\s*\(prefers-reduced-transparency:\s*reduce\)\s*\{\s*background-color:\s*var\(--role-scrim\);/);
  });

  it.each(COLOR_ROLES)("утилиты Tailwind по роли %s берут цвет из переменной темы", (role) => {
    const theme = block(css, /@theme inline/);
    expect(theme).toContain(`--color-${role}: var(--role-${role});`);
  });

  it("стандартные шкалы Tailwind обнулены", () => {
    for (const scale of ["color", "font", "font-weight", "text", "radius", "shadow", "inset-shadow", "drop-shadow", "text-shadow"]) {
      expect(css).toMatch(new RegExp(String.raw`--${scale}-\*:\s*initial;`));
    }
  });

  it("нет цветов вне TOKENS", () => {
    const allowed = new Set([...Object.values(TOKENS.light), ...Object.values(TOKENS.dark)]);
    const hexes = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
    expect(hexes.filter((hex) => !allowed.has(hex))).toEqual([]);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    expect(css).not.toMatch(/:\s*(?:black|white)\b/i);
  });

  it("вес шрифта не выше 600", () => {
    const weights = [...css.matchAll(/--font-weight-[a-z]+:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(weights.sort()).toEqual([400, 500, 600]);
    expect(css).not.toMatch(/--text-[a-z]+--font-weight:\s*(?:[7-9]\d\d|bold)/);
  });
});
