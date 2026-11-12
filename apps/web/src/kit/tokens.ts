/**
 * Цвета нового интерфейса (v2) — роли и их значения в светлой и тёмной теме.
 *
 * Источник — спека редизайна, раздел 4 (docs/superpowers/specs/2026-11-12-frontend-redesign-design.md).
 * Те же значения записаны в tokens.css (для Tailwind); tokens.test.ts держит их равными, contrast.test.ts
 * проверяет контраст пар. Hex живут только здесь и в tokens.css — экраны обращаются к ролям
 * (bg-canvas, text-ink…), а не к значениям.
 */

export const COLOR_ROLES = [
  "canvas", // фон страницы
  "surface", // карточки, меню
  "raised", // плавающее: шторка, поповер
  "ink", // основной текст
  "muted", // вторичный текст
  "line", // разделители внутри карточек и списков, трек прогресса
  "line-strong", // граница поля и выбора: 3:1 к фону (WCAG 1.4.11)
  "track", // дорожка сегментированного переключателя: темнее выбранного сегмента (raised) в обеих темах
  "action", // одна главная кнопка
  "on-action", // текст на главной кнопке
  "accent", // статус, деньги «под защитой», ссылка-пояснение, прогресс
  "accent-soft", // подложка акцентного чипа или плашки
  "danger", // ошибка, спор, отказ
  "danger-soft",
  "warn", // ожидание, предупреждение
  "warn-soft",
  "focus", // кольцо фокуса
  "scrim", // затемнение под шторкой и диалогом; прозрачность — в утилите scrim (tokens.css)
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export const TOKENS: { light: Record<ColorRole, string>; dark: Record<ColorRole, string> } = {
  light: {
    canvas: "#f5f5f7",
    surface: "#ffffff",
    raised: "#ffffff",
    ink: "#1d1d1f",
    muted: "#6e6e73",
    line: "#e5e5ea",
    "line-strong": "#8a8a8e",
    track: "#e5e5ea", // как line: белый выбранный сегмент на серой дорожке
    action: "#1d1d1f",
    "on-action": "#ffffff",
    accent: "#0a7d54",
    // В спеке #e3f1ea: на нём accent даёт 4,43:1 — ниже порога. На тон светлее — 4,52:1, на глаз то же.
    "accent-soft": "#e6f3ec",
    danger: "#b42d2d",
    "danger-soft": "#fbeceb",
    warn: "#8a5a00",
    "warn-soft": "#fbf1de",
    focus: "#0a7d54",
    scrim: "#000000",
  },
  dark: {
    canvas: "#000000",
    surface: "#1c1c1e",
    raised: "#2c2c2e",
    ink: "#f5f5f7",
    muted: "#a1a1a6",
    line: "#38383a",
    "line-strong": "#78787d",
    track: "#1c1c1e", // как surface: выбранный сегмент raised (#2c2c2e) светлее дорожки — приподнят, а не выемка
    action: "#f5f5f7",
    "on-action": "#1d1d1f",
    accent: "#30b07a",
    "accent-soft": "#12382a",
    danger: "#f2827a",
    "danger-soft": "#3d1d1c",
    warn: "#e3a23b",
    "warn-soft": "#3a2c12",
    focus: "#30b07a",
    scrim: "#000000",
  },
};
