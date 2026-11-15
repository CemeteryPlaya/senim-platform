import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_ROLES, GLASS, TOKENS, TRANSLUCENT } from "./tokens";

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
  it("в обеих темах одни и те же роли: сплошные в TOKENS, полупрозрачные в TRANSLUCENT", () => {
    const solid = COLOR_ROLES.filter((role) => !(role in TRANSLUCENT));
    expect(Object.keys(TOKENS.light).sort()).toEqual([...solid].sort());
    expect(Object.keys(TOKENS.dark).sort()).toEqual([...solid].sort());
  });

  it.each(Object.entries(BLOCKS))("%s: fill и fill-strong — доля ink поверх фона (color-mix), как в TRANSLUCENT", (name, { body }) => {
    const theme = name.startsWith("светлая") ? "light" : "dark";
    for (const [role, spec] of Object.entries(TRANSLUCENT)) {
      expect(body()).toContain(`--role-${role}: color-mix(in srgb, var(--role-${spec.of}) ${spec[theme]}%, transparent);`);
    }
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

  it("затемнение при prefers-reduced-transparency плотнее: непрозрачность 0,7, без размытия", () => {
    const scrim = /@utility scrim\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(scrim).toContain("var(--scrim-opacity)");
    expect(scrim).toMatch(
      /@media\s*\(prefers-reduced-transparency:\s*reduce\)\s*\{\s*background-color:\s*color-mix\(in srgb,\s*var\(--role-scrim\)\s+70%,\s*transparent\);/,
    );
    expect(scrim).not.toContain("backdrop-filter");
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

  it("нет цветов вне TOKENS и GLASS", () => {
    const allowed = new Set([
      ...Object.values(TOKENS.light),
      ...Object.values(TOKENS.dark),
      ...[GLASS.light, GLASS.dark].flatMap((g) => [g.tint, g.secondary]),
    ]);
    const hexes = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
    expect(hexes.filter((hex) => !allowed.has(hex))).toEqual([]);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    expect(css).not.toMatch(/:\s*(?:black|white)\b/i);
  });

  it('компьютерные размеры (заголовок 40 px, карточка 22 px, кнопка 12 px) заданы только под [data-device="desktop"]', () => {
    const theme = block(css, /@theme/);
    expect(theme).toMatch(/--text-title:\s*2\.125rem\s*;/); // 34 px на телефоне
    expect(theme).toMatch(/--radius-card:\s*1\.25rem\s*;/); // 20 px
    expect(theme).toMatch(/--radius-control:\s*1rem\s*;/); // 16 px
    const desktop = block(css, /:root\[data-device="desktop"\]/);
    expect(desktop).toMatch(/--text-title:\s*2\.5rem\s*;/);
    expect(desktop).toMatch(/--text-title--line-height:\s*1\.08\s*;/);
    expect(desktop).toMatch(/--radius-card:\s*1\.375rem\s*;/);
    expect(desktop).toMatch(/--radius-control:\s*0\.75rem\s*;/);
    // Вне @theme (значения телефона) и этого блока размеры не переопределяются: иначе версии смешались бы.
    const overrides = [...css.matchAll(/([^{}]+)\{[^{}]*--(?:text-title|radius-control|radius-card):/g)].map((m) => m[1].trim());
    expect(overrides).toEqual(['@theme', ':root[data-device="desktop"]']);
  });

  it("шкала текста (разбор 3.3): размер, межстрочный и трекинг по размеру; ₸ — 0,6 размера суммы", () => {
    const theme = block(css, /@theme/);
    const scale: [name: string, size: string, leading: string, tracking: string][] = [
      ["display-xl", "4rem", "1.03", "-0.035em"],
      ["display", "2.5rem", "1.08", "-0.03em"],
      ["display-amount", "2.5rem", "1.05", "-0.02em"],
      ["title", "2.125rem", "1.1", "-0.025em"],
      ["amount", "1.75rem", "1.1", "-0.02em"],
      ["title-2", "1.375rem", "1.25", "-0.018em"],
      ["lead", "1.3125rem", "1.4", "-0.016em"],
      ["headline", "1.0625rem", "1.35", "-0.013em"],
      ["body", "1.0625rem", "1.47", "-0.013em"],
      ["sub", "0.9375rem", "1.4", "-0.009em"],
      ["small", "0.8125rem", "1.35", "-0.003em"],
    ];
    for (const [name, size, leading, tracking] of scale) {
      expect(theme, name).toContain(`--text-${name}: ${size};`);
      expect(theme, name).toContain(`--text-${name}--line-height: ${leading};`);
      expect(theme, name).toContain(`--text-${name}--letter-spacing: ${tracking};`);
    }
    // Трекинг сжимается с ростом кегля: чем крупнее, тем отрицательнее (никогда не один на все размеры).
    const ordered = scale.filter(([name]) => name !== "display-amount" && name !== "amount");
    const trackings = ordered.map(([, , , tracking]) => Number.parseFloat(tracking));
    expect([...trackings].sort((a, b) => a - b)).toEqual(trackings);
    expect(theme).toContain("--text-currency: 0.6em;");
    // Старых имён шкалы больше нет.
    expect(css).not.toMatch(/--text-(?:card|section)\b/);
  });

  it("радиусы (разбор 3.6): чип и панель — капсулы, лист 32/24, миниатюра 12, фото в карточке концентрично", () => {
    const theme = block(css, /@theme/);
    expect(theme).toMatch(/--radius-chip:\s*9999px\s*;/);
    expect(theme).toMatch(/--radius-bar:\s*9999px\s*;/);
    expect(theme).toMatch(/--radius-sheet:\s*2rem\s*;/);
    expect(theme).toMatch(/--radius-sheet-full:\s*1\.5rem\s*;/);
    expect(theme).toMatch(/--radius-thumb:\s*0\.75rem\s*;/);
    expect(theme).toMatch(/--radius-field:\s*0\.75rem\s*;/);
    expect(theme).toMatch(/--spacing-photo-inset:\s*0\.5rem\s*;/);
    expect(theme).toContain("--radius-photo: calc(var(--radius-card) - var(--spacing-photo-inset));");
  });

  it("тени float, overlay, sheet, hover — по теме: в тёмной плотнее", () => {
    const theme = block(css, /@theme inline/);
    for (const name of ["float", "overlay", "sheet", "hover"]) expect(theme).toContain(`--shadow-${name}: var(--elev-${name});`);
    for (const [, { body }] of Object.entries(BLOCKS)) {
      for (const name of ["float", "overlay", "sheet", "hover"]) expect(body()).toMatch(new RegExp(String.raw`--elev-${name}:`));
    }
    const alpha = (body: string) => Number(/--elev-float:[^;]*?var\(--shade\) (\d+)%/.exec(body)?.[1]);
    expect(alpha(BLOCKS['тёмная, [data-theme="dark"]'].body())).toBeGreaterThan(alpha(BLOCKS["светлая, :root"].body()));
  });

  it("панель вкладок, шапка и аватар — именованные размеры", () => {
    const theme = block(css, /@theme/);
    expect(theme).toMatch(/--spacing-header:\s*3\.25rem\s*;/); // 52 px
    expect(theme).toMatch(/--spacing-bar-inset:\s*0\.625rem\s*;/); // 10 px
    expect(theme).toMatch(/--spacing-avatar:\s*2\.25rem\s*;/); // 36 px — шапка
    expect(theme).toMatch(/--spacing-avatar-md:\s*2\.75rem\s*;/); // 44 px — чаты
    expect(theme).toMatch(/--spacing-avatar-lg:\s*4\.5rem\s*;/); // 72 px — профиль
    expect(theme).toMatch(/--container-content:\s*68\.75rem\s*;/); // 1100 px
    expect(theme).toMatch(/--container-column:\s*35rem\s*;/); // 560 px
    const dock = /@utility dock-bottom\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(dock).toMatch(/bottom:\s*calc\(var\(--spacing-bar-inset\)\s*\+\s*env\(safe-area-inset-bottom\)\)\s*;/);
    expect(dock).toMatch(/margin-bottom:\s*calc\(var\(--spacing-bar-inset\)\s*\+\s*env\(safe-area-inset-bottom\)\)\s*;/);
  });

  it("dock-column: предки дока внутри main становятся растянутыми колонками (док у нижнего края на коротком экране)", () => {
    const body = /@utility dock-column\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    // Только при доке внутри и с нулевой специфичностью (:where): раскладку других предков не перебивает.
    expect(body).toContain(":where(&:has([data-action-dock]))");
    expect(body).toContain(":where(&) :where(:has([data-action-dock]))");
    expect(body).not.toContain("& :has");
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/flex-grow:\s*1/);
  });

  it("док в конце страницы считает нижнее поле колонки тем же токеном, что safe-block", () => {
    const utility = (name: string) => new RegExp(String.raw`@utility ${name}\s*\{([\s\S]*?)
\}`).exec(css)?.[1] ?? "";
    expect(css).toMatch(/--spacing-column-block:\s*1\.5rem\s*;/);
    expect(utility("dock-above-bar")).toContain("max(var(--spacing-column-block), env(safe-area-inset-bottom))");
    expect(utility("safe-block")).toContain("max(var(--spacing-column-block), env(safe-area-inset-bottom))");
    expect(utility("dock-above-bar")).not.toMatch(/1\.5rem/);
  });

  it("sticky-head: шапка прилипает к верху, верхнее поле колонки — тем же токеном, что safe-block; материал — отдельно (glass-bar)", () => {
    const body = /@utility sticky-head\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/top:\s*0/);
    expect(body).toContain("margin-top: calc(-1 * max(var(--spacing-column-block), env(safe-area-inset-top)))");
    expect(body).toContain("padding-top: max(var(--spacing-column-block), env(safe-area-inset-top))");
    // Ни материала, ни линии снизу: стекло и «растворение» вместо линии даёт glass-bar рядом в разметке.
    expect(body).not.toMatch(/backdrop-filter|background|border-bottom/);
  });

  it("безопасные зоны телефона: утилиты берут env(safe-area-inset-*), но не меньше обычного отступа", () => {
    const utility = (name: string) => new RegExp(String.raw`@utility ${name}\s*\{([\s\S]*?)\n\}`).exec(css)?.[1] ?? "";
    // Панель вкладок по бокам: 10 px или вырез в альбомной ориентации.
    const dockInline = utility("dock-inline");
    expect(dockInline).toMatch(/padding-left:\s*max\(var\(--spacing-bar-inset\),\s*env\(safe-area-inset-left\)\)\s*;/);
    expect(dockInline).toMatch(/padding-right:\s*max\(var\(--spacing-bar-inset\),\s*env\(safe-area-inset-right\)\)\s*;/);
    // Поля содержимого: 16 px по бокам, 24 px сверху и снизу.
    const gutter = utility("safe-gutter");
    expect(gutter).toMatch(/padding-left:\s*max\(1rem,\s*env\(safe-area-inset-left\)\)\s*;/);
    expect(gutter).toMatch(/padding-right:\s*max\(1rem,\s*env\(safe-area-inset-right\)\)\s*;/);
    const block = utility("safe-block");
    expect(block).toMatch(/padding-top:\s*max\(var\(--spacing-column-block\),\s*env\(safe-area-inset-top\)\)\s*;/);
    expect(block).toMatch(/padding-bottom:\s*max\(var\(--spacing-column-block\),\s*env\(safe-area-inset-bottom\)\)\s*;/);
  });

  it("шапка сосредоточенной оболочки: верх ниже выреза, справа поле на 16px меньше; safe-bottom — только низ", () => {
    const utility = (name: string) => new RegExp(String.raw`@utility ${name}\s*\{([\s\S]*?)
\}`).exec(css)?.[1] ?? "";
    const bar = utility("safe-bar");
    expect(bar).toMatch(/padding-top:\s*max\(var\(--spacing-stack-tight\),\s*env\(safe-area-inset-top\)\)\s*;/);
    expect(bar).toMatch(/padding-left:\s*max\(1rem,\s*env\(safe-area-inset-left\)\)\s*;/);
    expect(bar).toMatch(/padding-right:\s*max\(0rem,\s*calc\(env\(safe-area-inset-right\)\s*-\s*1rem\)\)\s*;/);
    const bottom = utility("safe-bottom");
    expect(bottom).toMatch(/padding-bottom:\s*max\(var\(--spacing-column-block\),\s*env\(safe-area-inset-bottom\)\)\s*;/);
    expect(bottom).not.toContain("padding-top");
    // Левое/правое поле main — по-прежнему safe-gutter, верх main под шапкой — не safe-block (вырез не учитывается дважды).
    expect(utility("safe-block")).toContain("env(safe-area-inset-top)");
  });

  it("scroll-fade: затухание к цвету карточки у нижнего края, пропадает в конце прокрутки; при reduced-transparency — линия", () => {
    const fade = /@utility scroll-fade\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(fade).toContain("linear-gradient(to bottom, transparent, var(--role-surface))");
    expect(fade).toContain("pointer-events: none");
    expect(fade).toMatch(/&\[data-end="true"\]::after\s*\{\s*opacity:\s*0;/);
    const reduced = /@media \(prefers-reduced-transparency: reduce\) \{([\s\S]*?)\}/.exec(fade)?.[1] ?? "";
    expect(reduced).toContain("background: none");
    expect(reduced).toContain("border-top: 1px solid var(--role-line-strong)");
    // Только роли-токены, без сырых цветов.
    expect(fade).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|hsl\(/i);
  });

  it("варианты по устройству: desktop: и mobile: — по data-device на <html>, а не по ширине окна", () => {
    expect(css).toContain('@custom-variant desktop (&:where([data-device="desktop"], [data-device="desktop"] *));');
    expect(css).toContain('@custom-variant mobile (&:where([data-device="mobile"], [data-device="mobile"] *));');
    // Брейкпоинтов по ширине в токенах нет.
    expect(css).not.toMatch(/--breakpoint-[a-z0-9]+:\s*\d/);
  });

  it("раскладка: поток 8 / 12 / 24 px (раздел на компьютере — 32 px), Split 1,5 : 1 с зазором 24 px, Narrow 560 px", () => {
    const theme = block(css, /@theme/);
    expect(theme).toMatch(/--spacing-stack-tight:\s*0\.5rem\s*;/);
    expect(theme).toMatch(/--spacing-stack-group:\s*0\.75rem\s*;/);
    expect(theme).toMatch(/--spacing-stack-section:\s*1\.5rem\s*;/);
    expect(theme).toMatch(/--spacing-split:\s*1\.5rem\s*;/);
    expect(theme).toMatch(/--grid-template-columns-split:\s*minmax\(0,\s*1\.5fr\)\s+minmax\(0,\s*1fr\)\s*;/);
    expect(theme).toMatch(/--container-narrow:\s*35rem\s*;/);
    // Narrow на компьютере и колонка планшета — одна ширина (спека, раздел 5: 560 px).
    const width = (name: string) => new RegExp(String.raw`--container-${name}:\s*([^;]+);`).exec(theme)?.[1];
    expect(width("narrow")).toBe(width("column"));
    const desktop = block(css, /:root\[data-device="desktop"\]/);
    expect(desktop).toMatch(/--spacing-stack-section:\s*2rem\s*;/);
  });

  it("полоса прогресса — 4 px, многострочное поле — от трёх строк", () => {
    const theme = block(css, /@theme/);
    expect(theme).toMatch(/--spacing-progress:\s*0\.25rem\s*;/);
    expect(theme).toMatch(/--spacing-area:\s*calc\(3lh\s*\+\s*1\.625rem\)\s*;/);
  });

  it("старой утилиты glass и --glass-opacity нет: только уровни glass-regular, glass-thick, glass-bar, glass-clear", () => {
    expect(css).not.toMatch(/@utility glass\s*\{/);
    expect(css).not.toContain("--glass-opacity");
    for (const name of ["glass-regular", "glass-thick", "glass-bar", "glass-clear"]) expect(css).toMatch(new RegExp(String.raw`@utility ${name}\s*\{`));
  });

  it.each(Object.entries(BLOCKS))("%s: тон, плотность и вторичный текст стекла — как в GLASS", (name, { body }) => {
    const g = GLASS[name.startsWith("светлая") ? "light" : "dark"];
    expect(body()).toContain(`--glass-tint: ${g.tint};`);
    expect(body()).toContain(`--glass-alpha: ${g.regular}%;`);
    expect(body()).toContain(`--glass-thick-alpha: ${g.thick}%;`);
    expect(body()).toContain(`--glass-secondary: ${g.secondary};`);
  });

  it("запасные плотности стекла и затемнение фото — как в GLASS (одни на обе темы)", () => {
    const root = block(css, /:root/);
    expect(root).toContain(`--glass-solid-alpha: ${GLASS.solid}%;`);
    expect(root).toContain(`--glass-clear-alpha: ${GLASS.clear.regular}%;`);
    expect(root).toContain(`--glass-clear-solid: ${GLASS.clear.solid}%;`);
    expect(root).toContain(`--glass-clear-reduced: ${GLASS.clear.reduced}%;`);
    expect(root).toContain(`--scrim-photo-alpha: ${GLASS.clear.scrim}%;`);
  });

  it.each(["glass-regular", "glass-thick", "glass-bar"])("%s: размытие с префиксом Safari и запасные виды без прозрачности", (name) => {
    const body = new RegExp(String.raw`@utility ${name}\s*\{([\s\S]*?)\n\}`).exec(css)?.[1] ?? "";
    expect(body).toContain("-webkit-backdrop-filter: blur(");
    expect(body).toMatch(
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*background-color: color-mix\(in srgb, var\(--glass-tint\) var\(--glass-solid-alpha\), transparent\);/,
    );
    for (const media of ["prefers-reduced-transparency: reduce", "prefers-contrast: more"]) {
      const inner = new RegExp(String.raw`@media \(${media}\) \{([\s\S]*?)\n  \}`).exec(body)?.[1] ?? "";
      expect(inner, media).toMatch(/background-color: var\(--role-(?:surface|raised)\);/);
      expect(inner, media).toContain("backdrop-filter: none;");
    }
    expect(body).toContain("@media (forced-colors: active)");
  });

  it("glass-regular и glass-thick: кромка и контур вместо серой рамки; позиция — с нулевой специфичностью", () => {
    for (const name of ["glass-regular", "glass-thick"]) {
      const body = new RegExp(String.raw`@utility ${name}\s*\{([\s\S]*?)\n\}`).exec(css)?.[1] ?? "";
      expect(body).toContain("inset 0 1px 0 var(--glass-edge-top)");
      expect(body).toContain("0 0 0 0.5px var(--glass-rim)");
      expect(body).toMatch(/:where\(&\) \{\s*position: relative;/);
      expect(body).toContain("mask-composite: exclude;");
      expect(body).not.toMatch(/\bborder:/);
    }
  });

  it("glass-bar: без линии — «растворение» под шапкой по прокрутке; при уменьшении прозрачности — линия line", () => {
    const body = /@utility glass-bar\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(body).not.toMatch(/border-bottom/);
    expect(body).toContain("animation-timeline: scroll(root);");
    expect(body).toContain("linear-gradient(to bottom, color-mix(in srgb, var(--glass-tint) 60%, transparent), transparent)");
    const reduced = /@media \(prefers-reduced-transparency: reduce\) \{([\s\S]*?)\n  \}/.exec(body)?.[1] ?? "";
    expect(reduced).toContain("background: var(--role-line);");
  });

  it("glass-clear: белый 600 на тёмной подложке; без размытия и при уменьшении прозрачности — плотнее", () => {
    const body = /@utility glass-clear\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(body).toContain("color: var(--role-on-photo);");
    expect(body).toContain("font-weight: var(--font-weight-semibold);");
    expect(body).toContain("background-color: color-mix(in srgb, var(--role-scrim) var(--glass-clear-alpha), transparent);");
    expect(body).toContain("background-color: color-mix(in srgb, var(--role-scrim) var(--glass-clear-solid), transparent);");
    expect(body).toMatch(
      /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{\s*background-color: color-mix\(in srgb, var\(--role-scrim\) var\(--glass-clear-reduced\), transparent\);/,
    );
  });

  it("scrim-photo: нижняя четверть — полное затемнение, к 60% — прозрачно плавно (много точек, монотонно); клики не перехватывает", () => {
    const body = /@utility scrim-photo\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(body).toContain("pointer-events: none;");
    expect(body).toContain("color-mix(in srgb, var(--role-scrim) var(--scrim-photo-alpha), transparent) 25%");
    expect(body).toContain("transparent 60%");
    // Спад — не одна прямая (на краю плато видна полоса), а не меньше пяти промежуточных точек с убывающей долей.
    const factors = [...body.matchAll(/calc\(var\(--scrim-photo-alpha\) \* ([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(factors.length).toBeGreaterThanOrEqual(5);
    expect([...factors].sort((a, b) => b - a)).toEqual(factors);
  });

  it("bar-underlay: растворение, а не плита — тон фона густеет к низу и не сплошной; видна только при вкладках или доке", () => {
    const body = /@utility bar-underlay\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(body).toContain("display: none;");
    expect(body).toMatch(/:where\(\[data-has-tabs\], :has\(\[data-action-dock\]\)\) > & \{\s*display: block;/);
    const alphas = [...body.split("@media")[0].matchAll(/var\(--role-canvas\) (\d+)%/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...alphas)).toBeLessThan(100);
    expect([...alphas].sort((a, b) => b - a)).toEqual(alphas);
    expect(body).toContain("var(--underlay-dock, 0px)");
  });

  it("вес шрифта не выше 600", () => {
    const weights = [...css.matchAll(/--font-weight-[a-z]+:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(weights.sort()).toEqual([400, 500, 600]);
    expect(css).not.toMatch(/--text-[a-z]+--font-weight:\s*(?:[7-9]\d\d|bold)/);
  });
});

describe("утилита pressable: отклик на нажатие", () => {
  const pressable = /@utility pressable\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

  it("масштаб --scale-press при нажатии, отключённый не откликается; переход только transform за 100 мс", () => {
    expect(pressable).toMatch(/&:active:not\(:disabled\)\s*\{\s*scale:\s*var\(--scale-press\)\s*;\s*\}/);
    expect(pressable).toMatch(/transition-property:\s*transform,\s*translate,\s*scale,\s*rotate\s*;/);
    expect(pressable).toMatch(/transition-duration:\s*100ms\s*;/);
    expect(css).toMatch(/--scale-press:\s*0\.97\s*;/);
  });

  it("при меньшем движении масштаб выключен (app.css: --scale-press: 1)", () => {
    const app = readFileSync(path.join(__dirname, "../app/(app)/app.css"), "utf8");
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(app)?.[1] ?? "";
    expect(reduced).toMatch(/--scale-press:\s*1\s*;/);
  });
});
