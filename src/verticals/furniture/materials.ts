/**
 * Справочник цен материалов (ADR-007): категории и единицы — мебельные, поэтому живут в вертикали.
 * Хранит строки оператор (таблица MaterialPrice, ключи отсюда), подписи — ru.materials.
 * Порядок ключей — порядок разделов на экране оператора.
 */
export const MATERIAL_CATEGORIES = ["carcass", "facade", "countertop", "hardware", "edge", "other"] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

/** Единица цены материала: м², лист, погонный метр, штука. */
export const MATERIAL_UNITS = ["m2", "sheet", "lm", "pcs"] as const;
export type MaterialUnit = (typeof MATERIAL_UNITS)[number];

/**
 * В чём меряется изделие в типовом расчёте: погонный метр (кухня, прихожая — по ширине)
 * или м² фасада (шкаф — ширина × высота).
 */
export const PRODUCT_UNITS = ["lm", "front_m2"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const isMaterialCategory = (v: string): v is MaterialCategory => (MATERIAL_CATEGORIES as readonly string[]).includes(v);
export const isMaterialUnit = (v: string): v is MaterialUnit => (MATERIAL_UNITS as readonly string[]).includes(v);
