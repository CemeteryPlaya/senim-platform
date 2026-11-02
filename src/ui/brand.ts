/**
 * Цвета бренда для мест, где нет CSS: манифест, theme-color, офлайн-страница сервис-воркера.
 * Источник — tokens.css; совпадение проверяет brand.test.ts.
 */
export const BRAND_COLORS = {
  primary: "#0f5b44",
  canvas: "#f7f7f4",
  surface: "#ffffff",
  ink: "#141917",
  muted: "#5a625e",
  onPrimary: "#ffffff",
} as const;
