import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GLASS, type SolidRole, TOKENS, TRANSLUCENT } from "./tokens";

// Контраст пар «передний план / фон» по WCAG 2.x для обеих тем. Цвета — из TOKENS и GLASS,
// а tokens.test.ts держит tokens.css равным им, так что проверяется то, что видит пользователь.
// Полупрозрачное (fill, стекло, затемнение фото) сводится к сплошному цвету наложением в sRGB — так смешивает браузер.

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

/** Цвет `fg` с непрозрачностью `percent` поверх сплошного `bg`. */
function over(fg: string, percent: number, bg: string): string {
  const a = percent / 100;
  const mix = (i: number) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a));
  return `#${[1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
}

const WHITE = "#ffffff";
const BLACK = "#000000";

/** Текст: WCAG AA для обычного текста — 4,5:1. */
const TEXT_PAIRS: [fg: SolidRole, bg: SolidRole][] = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["ink", "raised"],
  ["muted", "canvas"],
  ["muted", "surface"],
  ["muted", "raised"],
  // Подложка line (разделитель, полоса прогресса): текст на ней — только ink.
  ["ink", "line"],
  // Сегментированный переключатель: подписи на дорожке и на выбранном сегменте.
  ["ink", "track"],
  ["on-action", "action"],
  // Инверсная главная кнопка на фото: графит на белом в обеих темах.
  ["on-inverse", "on-photo"],
  ["accent", "surface"],
  ["accent", "canvas"],
  ["accent", "accent-soft"],
  // Переписка (Chat): своё сообщение — ink на bubble, чужое — ink на surface (пара выше).
  ["ink", "bubble"],
  // Блок денег «под защитой» (MoneyPanel): текст ink и вторичный muted на accent-soft (с тёплым muted — 5,24:1).
  ["ink", "accent-soft"],
  ["muted", "accent-soft"],
  ["danger", "surface"],
  ["danger", "danger-soft"],
  // Бейдж непрочитанного: цифры on-danger на сплошном danger (белый в светлой теме, графит в тёмной).
  ["on-danger", "danger"],
  ["warn", "surface"],
  ["warn", "warn-soft"],
];

/** Нетекстовые элементы (кольцо фокуса): WCAG 1.4.11 — 3:1. */
const UI_PAIRS: [fg: SolidRole, bg: SolidRole][] = [
  ["focus", "canvas"],
  ["focus", "surface"],
  ["line-strong", "canvas"],
  ["line-strong", "surface"],
  ["line-strong", "raised"],
];

const THEMES = ["light", "dark"] as const;
const cases = (pairs: [SolidRole, SolidRole][]) => THEMES.flatMap((theme) => pairs.map(([fg, bg]) => [theme, fg, bg] as const));

describe("переписка: свои и чужие сообщения различимы в обеих темах", () => {
  it.each(THEMES)("%s: подложка своего (bubble) не равна подложке чужого (surface) и фону страницы (canvas)", (theme) => {
    const t = TOKENS[theme];
    expect(t.bubble).not.toBe(t.surface);
    expect(t.bubble).not.toBe(t.canvas);
    expect(contrast(t.bubble, t.surface)).toBeGreaterThan(1.15);
  });
});

describe("сегмент переключателя приподнят над дорожкой", () => {
  it.each(THEMES)("%s: выбранный сегмент (raised) светлее дорожки (track)", (theme) => {
    expect(luminance(TOKENS[theme].raised)).toBeGreaterThan(luminance(TOKENS[theme].track));
  });
});

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

describe("заливка fill (полупрозрачный ink) на любом фоне", () => {
  // Вторичная кнопка, нейтральный чип, монограмма, отключённая кнопка (muted на fill — отличается от вторичной цветом
  // текста). Контраст неактивных WCAG не нормирует, но muted на fill и так не ниже 4,5:1.
  const BACKS = ["canvas", "surface", "raised"] as const;
  const fillCases = (["light", "dark"] as const).flatMap((theme) =>
    BACKS.flatMap((bg) => (["ink", "muted"] as const).map((fg) => [theme, fg, bg] as const)),
  );

  it.each(fillCases)("%s: %s на fill поверх %s — не ниже 4,5:1", (theme, fg, bg) => {
    const t = TOKENS[theme];
    const fill = over(t[TRANSLUCENT.fill.of], TRANSLUCENT.fill[theme], t[bg]);
    expect(contrast(t[fg], fill)).toBeGreaterThanOrEqual(4.5);
  });

  // На fill-strong (наведение, нажатие, линза) — только ink: muted там не ставится (≈ 4,0–4,5:1).
  const strongCases = fillCases.filter(([, fg]) => fg === "ink");
  it.each(strongCases)("%s: %s на fill-strong (наведение, нажатие, линза) поверх %s — не ниже 4,5:1", (theme, fg, bg) => {
    const t = TOKENS[theme];
    const strong = over(t[TRANSLUCENT["fill-strong"].of], TRANSLUCENT["fill-strong"][theme], t[bg]);
    expect(contrast(t[fg], strong)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["light", "dark"] as const)("%s: fill заметен на фоне страницы (вторичная кнопка не сливается с canvas)", (theme) => {
    const t = TOKENS[theme];
    expect(contrast(over(t.ink, TRANSLUCENT.fill[theme], t.canvas), t.canvas)).toBeGreaterThan(1.1);
  });
});

describe("стекло: текст читается при худшем фоне под панелью", () => {
  // Под панелью может оказаться что угодно: чёрное фото под светлым стеклом, белое — под тёмным. Проверяем оба края.
  const levels = (theme: "light" | "dark") =>
    [
      ["regular", GLASS[theme].regular],
      ["thick", GLASS[theme].thick],
      ["без backdrop-filter", GLASS.solid],
    ] as const;
  const glassCases = (["light", "dark"] as const).flatMap((theme) =>
    levels(theme).flatMap(([level, alpha]) =>
      (["ink", "glass-secondary"] as const).flatMap((fg) => [WHITE, BLACK].map((under) => [theme, fg, level, alpha, under] as const)),
    ),
  );

  it.each(glassCases)("%s: %s на стекле %s (%i%%) над %s — не ниже 4,5:1", (theme, fg, _level, alpha, under) => {
    const text = fg === "ink" ? TOKENS[theme].ink : GLASS[theme].secondary;
    expect(contrast(text, over(GLASS[theme].tint, alpha, under))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["light", "dark"] as const)("%s: обычный muted на стекле не ставится — при худшем фоне ниже 4,5:1", (theme) => {
    const worst = Math.min(...[WHITE, BLACK].map((under) => contrast(TOKENS[theme].muted, over(GLASS[theme].tint, GLASS[theme].regular, under))));
    expect(worst).toBeLessThan(4.5);
  });

  // Шапка во всю ширину (glass-bar: шапка компьютера, закреплённая шапка переписки) — плотность regular. На ней ни muted,
  // ни accent: при худшем фоне оба ниже 4,5:1. Поэтому PageTitle, BackLink и Explain на стекле — вариант onGlass
  // (ink и glass-secondary), а разметка экрана со стеклом — под сторожем ниже.
  it.each((["light", "dark"] as const).flatMap((theme) => (["muted", "accent"] as const).map((fg) => [theme, fg] as const)))(
    "%s: %s на glass-bar при худшем фоне ниже 4,5:1 — запрещён",
    (theme, fg) => {
      const worst = Math.min(...[WHITE, BLACK].map((under) => contrast(TOKENS[theme][fg], over(GLASS[theme].tint, GLASS[theme].regular, under))));
      expect(worst).toBeLessThan(4.5);
    },
  );

  // Опасный пункт меню («Открыть спор») на толстом стекле: текст danger при худшем фоне.
  it.each(["light", "dark"] as const)("%s: danger на glass-thick при худшем фоне — не ниже 4,5:1", (theme) => {
    const worst = Math.min(...[WHITE, BLACK].map((under) => contrast(TOKENS[theme].danger, over(GLASS[theme].tint, GLASS[theme].thick, under))));
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it("тёплый вторичный текст стекла светлой темы — #4a4844 (в тон ink)", () => {
    expect(GLASS.light.secondary).toBe("#4a4844");
  });
});

describe("сторож: на стекле шапки — только ink и glass-secondary", () => {
  // Разметка со стеклом шапки (glass-bar) и то, что она рендерит на нём: muted и accent там запрещены (тест выше).
  const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");

  it("закреплённая шапка переписки: заголовок и пояснение — в варианте onGlass", () => {
    const page = read("../app/(app)/v2/chats/[offerId]/page.tsx");
    expect(page).toContain("mobile:glass-bar");
    expect(page).toMatch(/<PageTitle[^>]*\bonGlass=/);
    expect(page).toMatch(/<Explain[^>]*\bonGlass=/);
  });

  it("шапка компьютера и меню разделов: без text-muted и text-accent", () => {
    for (const file of ["../app/(app)/_shell/DesktopShell.tsx", "../app/(app)/_shell/TopNav.tsx", "../app/(app)/_shell/AvatarMenu.tsx"]) {
      expect(read(file), file).not.toMatch(/\btext-(?:muted|accent)\b/);
    }
  });
});

describe("текст поверх фото: белый на затемнении и glass-clear", () => {
  // Самый светлый участок фото — белый. Затемнение scrim-photo обязательно: без него Clear не держит контраст.
  const { clear } = GLASS;
  const scrimmed = over(BLACK, clear.scrim, WHITE);

  it("на затемнении фото (scrim-photo) — не ниже 4,5:1", () => {
    expect(contrast(TOKENS.light["on-photo"], scrimmed)).toBeGreaterThanOrEqual(4.5);
  });

  it("на glass-clear поверх затемнения — не ниже 4,5:1", () => {
    expect(contrast(TOKENS.light["on-photo"], over(BLACK, clear.regular, scrimmed))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["без backdrop-filter", clear.solid],
    ["уменьшение прозрачности и увеличение контраста", clear.reduced],
  ] as const)("запасная подложка glass-clear (%s) держит 4,5:1 даже без затемнения", (_name, alpha) => {
    expect(contrast(TOKENS.light["on-photo"], over(BLACK, alpha, WHITE))).toBeGreaterThanOrEqual(4.5);
  });

  it("без затемнения glass-clear над белым фото не проходит — поэтому scrim-photo обязателен", () => {
    expect(contrast(TOKENS.light["on-photo"], over(BLACK, clear.regular, WHITE))).toBeLessThan(4.5);
  });

  it("on-photo — белый в обеих темах: фото задаёт свет само", () => {
    expect(TOKENS.light["on-photo"]).toBe(WHITE);
    expect(TOKENS.dark["on-photo"]).toBe(WHITE);
  });
});
