import type { Segment } from "@/generated/prisma/enums";

/**
 * Справочники мебельной вертикали. Типы мебели — стартовый набор для сида:
 * дальше справочник ведёт оператор (таблица FurnitureType).
 */
export const DEFAULT_FURNITURE_TYPES = [
  { slug: "kitchen", name: "Кухня" },
  { slug: "wardrobe", name: "Шкаф-купе" },
  { slug: "walk-in-closet", name: "Гардеробная" },
  { slug: "hallway", name: "Прихожая" },
  { slug: "kids-room", name: "Детская" },
  { slug: "bedroom", name: "Спальня" },
  { slug: "living-room", name: "Гостиная и ТВ-зона" },
  { slug: "bathroom", name: "Мебель для ванной" },
  { slug: "office", name: "Кабинет" },
  { slug: "table", name: "Стол" },
  { slug: "shelving", name: "Стеллаж" },
  { slug: "dresser", name: "Комод и тумбы" },
] as const;

export const STYLES = {
  modern: { name: "Современный", hint: "Простые формы, ровные фасады без рисунка" },
  minimalism: { name: "Минимализм", hint: "Без ручек, скрытая фурнитура, однотонные цвета" },
  scandi: { name: "Скандинавский", hint: "Светлые цвета, дерево, уют" },
  loft: { name: "Лофт", hint: "Тёмные цвета, металл, фактура дерева и бетона" },
  neoclassic: { name: "Неоклассика", hint: "Фрезеровка на фасадах, светлые тона, сдержанный декор" },
  classic: { name: "Классика", hint: "Резьба, карнизы, патина, массив" },
} as const;
export type StyleKey = keyof typeof STYLES;

type Option = { name: string; segment: Segment; segmentNote: string };

export const FACADES = {
  ldsp: { name: "ЛДСП", segment: "ECONOMY", segmentNote: "недорогой и практичный материал" },
  mdf_film: { name: "МДФ в плёнке", segment: "COMFORT", segmentNote: "фрезеровка и больше цветов, чем у ЛДСП" },
  mdf_enamel: { name: "МДФ эмаль", segment: "COMFORT", segmentNote: "окраска в несколько слоёв, ровный цвет" },
  acrylic: { name: "Акрил", segment: "COMFORT", segmentNote: "глянец без швов" },
  veneer: { name: "Шпон", segment: "PREMIUM", segmentNote: "натуральное дерево на поверхности" },
  solid_wood: { name: "Массив дерева", segment: "PREMIUM", segmentNote: "цельное дерево, сложная обработка" },
} as const satisfies Record<string, Option>;
export type FacadeKey = keyof typeof FACADES;

export const COUNTERTOPS = {
  ldsp: { name: "ЛДСП-столешница", segment: "ECONOMY", segmentNote: "базовый вариант" },
  compact: { name: "Компакт-плита", segment: "COMFORT", segmentNote: "тонкая и прочная" },
  artificial_stone: { name: "Искусственный камень", segment: "PREMIUM", segmentNote: "литьё под размер, без швов" },
  quartz: { name: "Кварцевый агломерат", segment: "PREMIUM", segmentNote: "очень прочный, дорогой материал" },
} as const satisfies Record<string, Option>;
export type CountertopKey = keyof typeof COUNTERTOPS;

export const HARDWARE = {
  standard: { name: "Стандартная", segment: "ECONOMY", segmentNote: "обычные петли и направляющие" },
  soft_close: { name: "С доводчиками", segment: "COMFORT", segmentNote: "двери и ящики закрываются плавно" },
  premium: { name: "Премиальная (Blum, Hettich)", segment: "PREMIUM", segmentNote: "дорогая фурнитура с гарантией производителя" },
} as const satisfies Record<string, Option>;
export type HardwareKey = keyof typeof HARDWARE;

export const SEGMENT_NAMES: Record<Segment, string> = {
  ECONOMY: "Эконом",
  COMFORT: "Комфорт",
  PREMIUM: "Премиум",
};
