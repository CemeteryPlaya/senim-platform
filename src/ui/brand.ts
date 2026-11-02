/**
 * Цвета бренда для мест, где нет CSS: манифест, theme-color, офлайн-страница сервис-воркера.
 * Источник — tokens.css; совпадение проверяет brand.test.ts.
 */
export const BRAND_COLORS = {
  primary: "#007d50",
  canvas: "#f1f5f9",
  surface: "#ffffff",
  ink: "#151a22",
  muted: "#566070",
  onPrimary: "#ffffff",
} as const;
