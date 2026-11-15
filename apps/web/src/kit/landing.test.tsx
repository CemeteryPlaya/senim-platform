import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PhoneFrame } from "./PhoneFrame";
import { count, hasClass, html } from "./test-utils";
import { TrustCapsule } from "./TrustCapsule";

// Утилиты лендинга (landing.css): затемнение первого экрана держит белый текст ≥ 4,5:1 по самому светлому (белому)
// участку фото; рамка телефона и капсула доверия.

const css = readFileSync(path.join(__dirname, "landing.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync(path.join(__dirname, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Относительная яркость канала sRGB (0–1). */
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Белый текст на белом фото под чёрным затемнением с непрозрачностью `alpha` (смешение в sRGB, как у браузера). */
const whiteOnDimmedWhite = (alpha: number) => 1.05 / (linear(1 - alpha) + 0.05);
/** Итоговая непрозрачность нескольких слоёв затемнения друг над другом. */
const stacked = (...alphas: number[]) => 1 - alphas.reduce((rest, a) => rest * (1 - a), 1);

function percent(source: string, name: string, block = ""): number {
  const scope = block ? (source.split(block)[1] ?? "") : source;
  const m = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)%`).exec(scope);
  if (!m) throw new Error(`нет --${name}`);
  return Number(m[1]) / 100;
}

describe("landing.css: контраст белого текста на фото", () => {
  const base = percent(css, "hero-scrim-base");
  const zone = percent(css, "hero-scrim-zone");

  it("первый экран компьютера: в колонке текста и в нижней полосе — ≥ 4,5:1 над белым фото", () => {
    expect(whiteOnDimmedWhite(stacked(base, zone))).toBeGreaterThanOrEqual(4.5);
  });

  it("без слоя колонки (только общее 30%) белый текст не читается — поэтому текст стоит только в колонке и внизу", () => {
    expect(whiteOnDimmedWhite(base)).toBeLessThan(4.5);
  });

  it("при увеличении контраста затемнение плотнее", () => {
    const more = css.split("prefers-contrast: more")[1] ?? "";
    expect(stacked(percent(more, "hero-scrim-base"), percent(more, "hero-scrim-zone"))).toBeGreaterThan(stacked(base, zone));
  });

  it("scrim-photo-top (капсула у верхнего края фото на телефоне) — то же плато, что scrim-photo: ≥ 4,5:1", () => {
    expect(css).toMatch(/@utility scrim-photo-top[\s\S]*var\(--scrim-photo-alpha\)[\s\S]*25%/);
    expect(whiteOnDimmedWhite(percent(tokens, "scrim-photo-alpha"))).toBeGreaterThanOrEqual(4.5);
  });

  it("в landing.css нет сырых цветов — только роли", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|hsl|oklch)a?\(/);
  });
});

describe("PhoneFrame", () => {
  it("снимок в рамке: next/image с размерами и sizes, ленивая загрузка, скругление экрана концентрично рамке", () => {
    const out = html(<PhoneFrame src="/app-screens/request-new.webp" width={600} height={1298} alt="Экран" sizes="15rem" className="w-60" />);
    expect(hasClass(out.match(/<div[^>]*>/)?.[0] ?? "", "phone-frame")).toBe(true);
    expect(out).toContain("rounded-phone-screen");
    expect(out).toMatch(/<img [^>]*alt="Экран"[^>]*loading="lazy"[^>]*width="600" height="1298"/);
    expect(out).toContain('sizes="15rem"');
  });
});

describe("TrustCapsule", () => {
  it("капсула на стекле glass-clear со щитом; текст, а не кнопка; цель 48 px", () => {
    const out = html(<TrustCapsule>Деньги в банке под защитой</TrustCapsule>);
    const tag = out.match(/<p[^>]*>/)?.[0] ?? "";
    for (const cls of ["glass-clear", "rounded-chip", "min-h-control"]) expect(hasClass(tag, cls)).toBe(true);
    expect(count(out, "<svg")).toBe(1);
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain("<button");
  });
});
