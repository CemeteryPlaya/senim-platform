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

  it("первый экран компьютера: в колонке текста, в нижней и верхней полосе — ≥ 4,9:1 над белым фото (запас над 4,5)", () => {
    // Расчёт по худшему случаю (белое фото): 5,05. Замер по самому светлому пикселю реального фото — 5,06 и выше.
    // Запас нужен: при 55% (расчёт 4,78) замер на отрисовке дал 4,77 — цвет градиента округляется до 8 бит.
    const ratio = whiteOnDimmedWhite(stacked(base, zone));
    expect(ratio).toBeGreaterThanOrEqual(4.9);
    expect(ratio).toBeCloseTo(5.05, 1);
  });

  it("без слоя колонки (только общее 30%) белый текст не читается — поэтому текст стоит только в колонке и внизу", () => {
    expect(whiteOnDimmedWhite(base)).toBeLessThan(4.5);
  });

  it("при увеличении контраста затемнение плотнее", () => {
    const more = css.split("prefers-contrast: more")[1] ?? "";
    expect(stacked(percent(more, "hero-scrim-base"), percent(more, "hero-scrim-zone"))).toBeGreaterThan(stacked(base, zone));
  });

  it("капсула у нижнего края фото на телефоне — на scrim-photo: ≥ 4,5:1 над белым фото", () => {
    expect(css).not.toContain("scrim-photo-top");
    expect(whiteOnDimmedWhite(percent(tokens, "scrim-photo-alpha"))).toBeGreaterThanOrEqual(4.5);
  });

  it("док над тёмным разделом на телефоне: шкала просмотра раздела в полосе центра кнопки, кнопка инверсная, растворение в тон раздела; без шкал — светлая кромка", () => {
    expect(css).toMatch(/\[data-mobile-shell\]:has\(\[data-landing-money\]\)\) \{\s*timeline-scope: --landing-money;/);
    const scroll = css.slice(css.indexOf("@supports (view-timeline-name"), css.indexOf("@supports not"));
    expect(scroll).toMatch(/view-timeline: --landing-money block;/);
    expect(scroll).toMatch(/view-timeline-inset: calc\(100% - var\(--landing-dock-center\)\) var\(--landing-dock-center\);/);
    // Центр кнопки — теми же токенами, что dock-above-bar.
    expect(scroll).toMatch(
      /--landing-dock-center: calc\(\s*var\(--spacing-bar-inset\) \+ env\(safe-area-inset-bottom\) \+ var\(--tab-bar-space, 0px\) \+ var\(--spacing-control\) \/ 2/,
    );
    expect(scroll).toMatch(/\[data-action-dock\] \[data-primary-action\] \{\s*animation: landing-dock-over-dark linear none;\s*animation-timeline: --landing-money;/);
    expect(scroll).toMatch(/> \.bar-underlay \{\s*animation: landing-underlay-over-dark linear none;/);
    const frames = css.slice(css.indexOf("@keyframes landing-dock-over-dark"));
    expect(frames).toMatch(/background-color: var\(--role-on-photo\);\s*color: var\(--role-on-inverse\);/);
    expect(css.slice(css.indexOf("@keyframes landing-underlay-over-dark"))).toMatch(/--role-canvas: color-mix\(in srgb, var\(--role-scrim\) 89%, var\(--role-on-photo\)\);/);
    expect(css.slice(css.indexOf("@supports not"))).toMatch(/\[data-primary-action\] \{\s*box-shadow:/);
  });

  it("заголовок первого экрана на телефоне — 36 px, не крупнее 11vw (шрифт 200 %: слово целиком в строке)", () => {
    expect(css).toMatch(/--text-hero-mobile: min\(2\.25rem, 11vw\);/);
  });

  it("шапка над первым экраном прозрачна только в самом верху и только там, где есть анимация по прокрутке; не при уменьшении прозрачности и увеличении контраста", () => {
    const block = css.slice(css.indexOf("@supports (animation-timeline: scroll())"));
    expect(block).toMatch(/@media not \(\(prefers-reduced-transparency: reduce\) or \(prefers-contrast: more\)\)/);
    expect(block).toMatch(/\[data-hero\]\) \[data-top-bar\][\s\S]*animation-range: 0 1rem/);
    // Белый текст шапки стоит на верхней полосе затемнения — она того же уровня, что колонка текста.
    expect(css).toMatch(/to bottom,\s*color-mix\(in srgb, var\(--role-scrim\) var\(--hero-scrim-zone\)/);
  });

  it("шапка над первым экраном в светлой теме: на любой прокрутке 0–1rem текст ≥ 4,5:1 — фон и цвет текста меняются одним шагом", () => {
    // Анимация по прокрутке: цвет текста (свойства-переменные) переключается дискретно — на половине прогресса, а фон
    // (стекло glass-bar) при плавной функции растёт постепенно. Тогда на прокрутке в несколько пикселей белый текст стоит
    // на полупрозрачном белом стекле (≈ 2,4:1), а тёмный сразу после переключения — на полупрозрачном стекле над тёмным
    // фото (≈ 2,9:1). Поэтому функция — ступень в конце диапазона: до 1rem шапка прозрачна с белым текстом, с 1rem — стекло
    // с тёмным; промежуточного вида нет.
    const rule = /\[data-hero\]\) \[data-top-bar\] \{\s*animation: top-bar-over-photo ([^;]+);/.exec(css);
    expect(rule).not.toBeNull();
    const timing = (rule?.[1] ?? "").split(/\s+/).filter((part) => part !== "top-bar-over-photo" && part !== "both")[0];
    /** Выход функции времени для прогресса прокрутки `t` (0–1): поддержаны ступень в конце и линейная. */
    const progress = (t: number): number => {
      if (timing === "step-end" || timing === "steps(1,end)" || timing === "steps(1, end)") return t < 1 ? 0 : 1;
      if (timing === "linear") return t;
      throw new Error(`неожиданная функция времени шапки: ${timing}`);
    };
    const glass = percent(tokens, "glass-alpha"); // светлая тема: белое стекло
    const dim = stacked(base, zone); // верхняя полоса затемнения под шапкой
    const ink = linear(0x1d / 255) * 0.2126 + linear(0x1c / 255) * 0.7152 + linear(0x1a / 255) * 0.0722; // --role-ink светлой темы
    for (let step = 0; step < 16; step += 1) {
      const p = progress(step / 16);
      const g = glass * p;
      if (p < 0.5) {
        // Белый текст; худший фон — самое светлое (белое) фото под затемнением и стеклом.
        const bg = (1 - dim) * (1 - g) + g;
        expect(1.05 / (linear(bg) + 0.05), `прокрутка ${step}px, белый текст`).toBeGreaterThanOrEqual(4.5);
      } else {
        // Тёмный текст; худший фон — самое тёмное (чёрное) фото под стеклом.
        expect((linear(g) + 0.05) / (ink + 0.05), `прокрутка ${step}px, тёмный текст`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("на всю ширину — без 100vw и без обрезки корня: узкое окно компьютера прокручивается вбок", () => {
    expect(css).not.toMatch(/100vw|50vw/);
    expect(css).not.toMatch(/overflow-x:\s*clip/);
    expect(css).toMatch(/:root\[data-device="desktop"\] main:has\(> \[data-landing\]\) \{\s*max-width: none;\s*padding-inline: 0;\s*padding-top: 0;/);
  });

  it("переход фото в фон — ниже текста: нижнее поле первого экрана больше полосы растворения", () => {
    expect(css).toMatch(/@utility hero-fade \{[\s\S]*height: 4rem;[\s\S]*var\(--role-canvas\)/);
    const hero = readFileSync(path.join(__dirname, "../app/(app)/v2/_home/GuestLanding.tsx"), "utf8");
    expect(hero).toContain("pb-28"); // 7rem > 4rem
  });

  it("кольцо фокуса на фото и в прозрачной шапке — двойное: светлое снаружи, тёмное внутри", () => {
    expect(css).toMatch(/\[data-hero\] :focus-visible \{\s*outline-color: var\(--role-on-photo\);\s*box-shadow: 0 0 0 2px var\(--role-scrim\);/);
    const frames = css.slice(css.indexOf("@keyframes top-bar-over-photo"));
    expect(frames).toMatch(/--role-focus: var\(--role-on-photo\);[\s\S]*--focus-halo: var\(--role-scrim\);/);
    expect(frames).toMatch(/\[data-top-bar\] :focus-visible \{\s*box-shadow: 0 0 0 2px var\(--focus-halo, transparent\);/);
  });

  it("белые роли прозрачной шапки не достают меню и поповеры: они рендерятся в портал вне шапки; первый экран — только у главной гостя", () => {
    const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
    expect(read("Menu.tsx")).toContain("DropdownMenu.Portal");
    expect(read("Popover.tsx")).toContain("PopoverPrimitive.Portal");
    expect(read("Sheet.tsx")).toContain("Drawer.Portal");
    expect(read("../app/(app)/_shell/AvatarMenu.tsx")).toContain("DropdownMenu.Portal");
    // Переопределение — только у [data-top-bar] на странице с [data-hero]; [data-hero] ставит только лендинг гостя.
    const home = read("../app/(app)/v2/_home/GuestLanding.tsx");
    expect(home).toContain("data-hero");
    expect(css.match(/\[data-top-bar\]/g)?.length).toBe(2);
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
