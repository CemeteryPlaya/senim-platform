import { brand } from "@/config/brand";

/**
 * Цвета бренда для мест, где нет CSS: манифест, theme-color, офлайн-страница сервис-воркера.
 * Источник — src/config/brand.ts; совпадение с tokens.css проверяет brand.test.ts.
 */
export const BRAND_COLORS = brand.colors;
