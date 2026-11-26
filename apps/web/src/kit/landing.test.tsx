import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PhoneFrame } from "./PhoneFrame";
import { count, hasClass, html } from "./test-utils";
import { TOP_BAR_FADE_MS, TOP_BAR_GLASS_FROM_REM, topBarFade, topBarTarget } from "./top-bar-logic";
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

  /** Правило шапки над фото: `:root[data-device="desktop"]:has([data-hero]) [data-top-bar] { … }` (первое, без вложений). */
  const topBarRule = (): string => /\[data-hero\]\) \[data-top-bar\] \{([^{}]*)\}/.exec(css)?.[1] ?? "";

  it("цвета текста шапки над фото — обычные объявления от --top-bar-p, а не анимация: Chrome рисует посещённые ссылки цветом без анимированных переменных", () => {
    // Корень (стенд, Chrome 157): ссылки шапки («Сенім», разделы, «Войти») после посещения — :visited. Цвет посещённой
    // ссылки Chrome берёт из своего «посещённого» цвета, который не пересчитывается от переменных (--role-ink и др.),
    // заданных анимацией (keyframes) или переходом. Фон шапки из той же анимации прозрачный, а посещённые ссылки
    // оставались тёмными (--role-ink) на тёмном фото; getComputedStyle при этом отвечает «белый» (защита истории), поэтому
    // прошлые проверки этого не видели. Значит, переменные текста шапки задаются только обычными объявлениями.
    const textRoles = ["--role-ink", "--glass-secondary", "--role-fill", "--role-fill-strong", "--role-focus", "--focus-halo"];
    for (const [, name, body] of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
      for (const role of textRoles) expect(body, `@keyframes ${name} задаёт ${role}`).not.toContain(`${role}:`);
    }
    for (const [, body] of css.matchAll(/\[data-top-bar\][^{]*\{([^{}]*)\}/g)) {
      expect(body).not.toMatch(/animation|transition/);
    }
    const rule = topBarRule();
    expect(rule).toMatch(/--top-bar-p: 0;/);
    expect(rule).toMatch(/--role-ink: color-mix\(in srgb, var\(--top-bar-ink\) calc\(var\(--top-bar-p\) \* 100%\), var\(--role-on-photo\)\);/);
    expect(rule).toMatch(/--glass-secondary: color-mix\(in srgb, var\(--top-bar-secondary\) calc\(var\(--top-bar-p\) \* 100%\), var\(--role-on-photo\)\);/);
    expect(rule).toMatch(/background-color: color-mix\(in srgb, var\(--glass-tint\) calc\(var\(--glass-alpha\) \* var\(--top-bar-p\)\), transparent\);/);
    expect(rule).toMatch(/\bbackdrop-filter: blur\(calc\(var\(--glass-blur\) \* var\(--top-bar-p\)\)\)/);
    // Цвета темы берутся у оболочки — выше шапки, где роли ещё не переопределены.
    expect(css).toMatch(/\[data-hero\]\) \[data-desktop-shell\] \{\s*--top-bar-ink: var\(--role-ink\);\s*--top-bar-secondary: var\(--glass-secondary\);/);
  });

  it("шапка над первым экраном прозрачна только в самом верху; не при уменьшении прозрачности и увеличении контраста; без скриптов — стекло", () => {
    const block = css.slice(css.indexOf("@media not ((prefers-reduced-transparency: reduce) or (prefers-contrast: more))"));
    expect(block).toMatch(/^@media not \(\(prefers-reduced-transparency: reduce\) or \(prefers-contrast: more\)\) \{\s*:root\[data-device="desktop"\]:has\(\[data-hero\]\) \[data-top-bar\] \{/);
    // До запуска React открытая прокрученной страница — стекло: атрибут на <html> ставит встроенный скрипт.
    expect(block).toMatch(/:root\[data-device="desktop"\]\[data-top-bar-glass\]:has\(\[data-hero\]\) \[data-top-bar\] \{\s*--top-bar-p: 1;/);
    expect(block).toMatch(/@media \(scripting: none\) \{\s*:root\[data-device="desktop"\]:has\(\[data-hero\]\) \[data-top-bar\] \{\s*--top-bar-p: 1;/);
    // Белый текст шапки стоит на верхней полосе затемнения — она того же уровня, что колонка текста.
    expect(css).toMatch(/to bottom,\s*color-mix\(in srgb, var\(--role-scrim\) var\(--hero-scrim-zone\)/);
  });

  describe("шапка над первым экраном в светлой теме: контраст на переходе", () => {
    const glass = percent(tokens, "glass-alpha"); // светлая тема: белое стекло
    const dim = stacked(base, zone); // верхняя полоса затемнения под шапкой
    type Rgb = readonly [number, number, number];
    const rgb = (hex: number): Rgb => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    const L = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    /**
     * Худший контраст текста `target` (смешан с белым: color-mix … calc(p * 100%)) на шапке с прогрессом `p` — по всем
     * фото от чёрного до белого под затемнением; стекло — белое с непрозрачностью glass-alpha · p (смешение в sRGB).
     */
    const worst = (p: number, target: number) => {
      const [r, g, b] = rgb(target);
      const text = L([1 - p + r * p, 1 - p + g * p, 1 - p + b * p]);
      let min = Infinity;
      for (let photo = 0; photo <= 1; photo += 0.01) {
        const v = glass * p + (1 - glass * p) * photo * (1 - dim);
        min = Math.min(min, ratio(text, L([v, v, v])));
      }
      return min;
    };
    const ink = 0x1d1c1a; // --role-ink светлой темы
    const secondary = 0x4a4844; // --glass-secondary светлой темы

    it("в покое — только два вида, оба ≥ 4,5:1: прозрачная с белым текстом (прокрутка < 1rem) и стекло с тёмным", () => {
      expect(topBarTarget(0, 16, 0)).toBe(0);
      expect(topBarTarget(15.9, 16, 0)).toBe(0);
      expect(topBarTarget(16, 16, 0)).toBe(1);
      expect(TOP_BAR_GLASS_FROM_REM).toBe(1); // белый текст держит контраст, пока шапка над полосой затемнения (её высота + 1rem)
      for (const target of [ink, secondary]) {
        expect(worst(0, target)).toBeGreaterThanOrEqual(4.5);
        expect(worst(1, target)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("переход плавный (не ступенькой), а промежуточный вид ниже 4,5:1 длится не дольше 0,1 с (Ruling: середина плавности)", () => {
      // Фон и текст меняются вместе (одна переменная). Белый текст держит 4,5:1 только на почти прозрачной шапке, тёмный —
      // только на почти плотном стекле; между ними по худшему фото контраст неизбежно ниже. Переход идёт по времени, а
      // не по прокрутке, — в покое такого вида не бывает; кривая проходит середину быстрее краёв.
      const samples = Array.from({ length: TOP_BAR_FADE_MS + 1 }, (_, ms) => topBarFade(0, 1, ms, false));
      expect(new Set(samples.map((p) => p.toFixed(2))).size).toBeGreaterThan(50);
      for (const target of [ink, secondary]) {
        const low = samples.filter((p) => worst(p, target) < 4.5).length;
        expect(low).toBeLessThanOrEqual(100);
      }
    });

    it("меньше движения — сразу, без промежуточного вида", () => {
      expect(topBarFade(0, 1, 0, true)).toBe(1);
      expect(topBarFade(1, 0, 50, true)).toBe(0);
    });
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
    const rule = topBarRule();
    expect(rule).toMatch(/--role-focus: color-mix\(in srgb, var\(--top-bar-focus\) calc\(var\(--top-bar-p\) \* 100%\), var\(--role-on-photo\)\);/);
    expect(rule).toMatch(/--focus-halo: color-mix\(in srgb, var\(--role-scrim\) calc\(\(1 - var\(--top-bar-p\)\) \* 100%\), transparent\);/);
    expect(css).toMatch(/\[data-top-bar\] :focus-visible \{\s*box-shadow: 0 0 0 2px var\(--focus-halo, transparent\);/);
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
    const bars = [...css.matchAll(/([^{}]*)\[data-top-bar\]/g)].map((m) => (m[1] ?? "").trim());
    expect(bars.length).toBeGreaterThan(0);
    for (const prefix of bars) expect(prefix).toMatch(/:root\[data-device="desktop"\](?:\[data-top-bar-glass\])?:has\(\[data-hero\]\)$/);
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
    expect(out).not.toContain("phone-frame-cut");
  });

  it("cropped: только верх экрана 3:4, рамка обрезана снизу и растворяется", () => {
    const out = html(<PhoneFrame src="/app-screens/request-new.webp" width={600} height={1298} alt="Экран" sizes="15rem" cropped />);
    expect(hasClass(out.match(/<div[^>]*>/)?.[0] ?? "", "phone-frame-cut")).toBe(true);
    expect(out).toContain("aspect-3/4");
    expect(out).toMatch(/<img [^>]*class="[^"]*object-top/);
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
