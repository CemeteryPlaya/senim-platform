/**
 * Цвета нового интерфейса (v2) — роли и их значения в светлой и тёмной теме.
 *
 * Источник — спека редизайна, раздел 18 (пересмотр вида 15.11.2026), и разбор docs/design/v3/review-2026-11-15-critique.md,
 * 3.2 (палитра) и 3.4 (стекло). Тёплые нейтральные: фон «камень», тёплый графит; зелёный — только деньги, «под защитой»
 * и прогресс. Те же значения записаны в tokens.css (для Tailwind); tokens.test.ts держит их равными, contrast.test.ts
 * проверяет контраст пар. Hex живут только здесь и в tokens.css — экраны обращаются к ролям (bg-canvas, text-ink…),
 * а не к значениям.
 */

export const COLOR_ROLES = [
  "canvas", // фон страницы
  "surface", // карточки
  "raised", // плавающее: шторка, поповер, меню
  "ink", // основной текст
  "muted", // вторичный текст (не на стекле: там glass-secondary)
  "line", // разделители внутри карточек и списков
  "line-strong", // граница поля и выбора: 3:1 к фону (WCAG 1.4.11)
  "fill", // полупрозрачная заливка ink: вторичная кнопка, нейтральный чип, дорожка, монограмма (см. TRANSLUCENT)
  "track", // дорожка сегментированного переключателя: темнее выбранного сегмента (raised) в обеих темах
  "bubble", // своё сообщение в переписке (Chat): нейтральная подложка, отличная от surface (чужие) в обеих темах
  "action", // одна главная кнопка
  "on-action", // текст на главной кнопке
  "accent", // деньги «под защитой», ссылка-пояснение, прогресс
  "accent-soft", // подложка акцентного чипа или плашки
  "danger", // ошибка, спор, отказ; бейдж непрочитанного
  "on-danger", // текст на сплошном danger (цифры бейджа): белый в светлой теме, графит в тёмной
  "danger-soft",
  "warn", // нужно действие человека, ожидание
  "warn-soft",
  "focus", // кольцо фокуса
  "scrim", // затемнение под шторкой и диалогом и на фото; прозрачность — в утилитах scrim и scrim-photo (tokens.css)
  "photo-fallback", // заливка места фото до загрузки
  "on-photo", // текст поверх фото (на затемнении и glass-clear) и инверсная кнопка на тёмном фото: белый в обеих темах
  "on-inverse", // текст инверсной главной кнопки (белая на тёмном фото): графит в обеих темах
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

/**
 * Полупрозрачные роли: доля (в процентах) цвета другой роли поверх того, что лежит под элементом. Одна заливка `fill`
 * работает на canvas, surface и raised — без отдельного hex на каждый фон. В tokens.css — color-mix от роли-основы.
 */
export const TRANSLUCENT = {
  fill: { of: "ink", light: 6, dark: 8 },
} as const satisfies Record<string, { of: ColorRole; light: number; dark: number }>;

/** Роли со сплошным hex (все, кроме полупрозрачных). */
export type SolidRole = Exclude<ColorRole, keyof typeof TRANSLUCENT>;

export const TOKENS: { light: Record<SolidRole, string>; dark: Record<SolidRole, string> } = {
  light: {
    canvas: "#f6f5f2", // тёплый «камень»
    surface: "#ffffff",
    raised: "#ffffff",
    ink: "#1d1c1a",
    muted: "#66635d",
    line: "#e7e5e0",
    "line-strong": "#8a877f",
    track: "#e7e5e0", // как line: белый выбранный сегмент на тёплой серой дорожке
    bubble: "#e7e5e0", // как track: своё сообщение серое рядом с белым чужим
    action: "#1d1c1a",
    "on-action": "#ffffff",
    accent: "#0a7d54",
    // В спеке #e3f1ea: на нём accent даёт 4,43:1 — ниже порога. На тон светлее — 4,52:1, на глаз то же.
    "accent-soft": "#e6f3ec",
    danger: "#b42d2d",
    "on-danger": "#ffffff",
    "danger-soft": "#fbeceb",
    warn: "#8a5a00",
    "warn-soft": "#fbf1de",
    focus: "#0a7d54",
    scrim: "#000000",
    "photo-fallback": "#e9e6e0",
    "on-photo": "#ffffff",
    "on-inverse": "#1d1c1a",
  },
  dark: {
    // Тёплый графит вместо чистого чёрного: на OLED разницы не видно, а фото дерева на нём лучше.
    canvas: "#0d0d0c",
    surface: "#1b1a18",
    raised: "#272522",
    ink: "#f5f3ef",
    muted: "#a8a49c",
    line: "#34322e",
    "line-strong": "#7d7970",
    track: "#1b1a18", // как surface: выбранный сегмент raised светлее дорожки — приподнят, а не выемка
    // Своё сообщение светлее raised: raised (#272522) к surface — 1,14, свои слились бы с чужими (порог теста 1,15).
    bubble: "#302e2a",
    action: "#f5f3ef",
    "on-action": "#1d1c1a",
    accent: "#3fb985",
    "accent-soft": "#113524",
    danger: "#f2827a",
    // Белый на светлом danger тёмной темы — 2,55:1; графит — 6,69:1.
    "on-danger": "#1d1c1a",
    "danger-soft": "#3a1c1a",
    warn: "#e3a23b",
    "warn-soft": "#35290f",
    focus: "#3fb985",
    scrim: "#000000",
    "photo-fallback": "#262421",
    "on-photo": "#ffffff",
    "on-inverse": "#1d1c1a",
  },
};

/**
 * Стекло (Liquid Glass, разбор 3.4): тон материала, его плотность и вторичный текст на нём — по теме. Плотность выбрана
 * по худшему фону под панелью: в светлой теме — чёрное фото (подложка ≈ #c7c7c7), в тёмной — белое (≈ #4b4a49).
 * Обычный muted на стекле не ставится (3,5:1 на худшем фоне) — только ink и glass-secondary. contrast.test.ts считает
 * обе пары по худшему фону для обычного и толстого стекла и для запасной плотности без backdrop-filter.
 */
export const GLASS: {
  light: { tint: string; secondary: string; regular: number; thick: number };
  dark: { tint: string; secondary: string; regular: number; thick: number };
  /** Плотность в браузере без backdrop-filter: почти сплошной, текст под панелью не читается сквозь неё. */
  solid: number;
  /** Clear поверх фото: тёмная подложка капсулы, затемнение фото под ней и запасные плотности. */
  clear: { regular: number; solid: number; reduced: number; scrim: number };
} = {
  light: { tint: "#ffffff", secondary: "#48474a", regular: 78, thick: 86 },
  dark: { tint: "#1e1d1b", secondary: "#c7c3bb", regular: 80, thick: 88 },
  solid: 96,
  clear: { regular: 28, solid: 60, reduced: 78, scrim: 55 },
};
