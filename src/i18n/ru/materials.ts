// Тексты зоны «materials»: справочник цен материалов у оператора и вилка по материалам в мастере заявки (ADR-007).

import type { MaterialCategory, MaterialUnit, ProductUnit } from "@/verticals/furniture";

const categories: Record<MaterialCategory, string> = {
  carcass: "Плита корпуса",
  facade: "Фасады",
  countertop: "Столешницы",
  hardware: "Фурнитура",
  edge: "Кромка",
  other: "Прочее",
};

const units: Record<MaterialUnit, string> = { m2: "м²", sheet: "лист", lm: "п. м", pcs: "шт." };

const productUnits: Record<ProductUnit, string> = { lm: "п. м", front_m2: "м² фасада" };

export const materials = {
  categories,
  units,
  productUnits,

  nav: "Цены материалов",
  navHint: "Средние цены для вилки по уровням",

  title: "Цены материалов",
  description: "Средние рыночные цены материалов по уровням. Из них считается примерная вилка цены в мастере заявки.",
  demoTitle: "Демонстрационные цифры",
  demoNote: "Цены с пометкой «Демо» заполнены для показа. Замените их реальными: после изменения пометка снимается.",
  demoBadge: "Демо",
  archivedBadge: "В архиве",

  add: {
    title: "Добавить материал",
    category: "Категория",
    name: "Название",
    nameHint: "Например: «ЛДСП 16 мм, Egger»",
    unit: "Единица",
    price: "Средняя цена, ₸",
    priceHint: "Целые тенге за единицу",
    segments: "Уровни",
    segmentsHint: "Один или несколько: материал войдёт в вилку каждого отмеченного уровня",
    submit: "Добавить",
    done: "Материал добавлен",
  },

  perUnit: (price: string, unit: string) => `${price} за ${unit}`,
  updated: (date: string, who: string | null) => (who ? `Обновлено ${date}, ${who}` : `Обновлено ${date}`),
  changePrice: "Изменить цену",
  changePriceLabel: (name: string, unit: string) => `Новая цена за ${unit}: ${name}, ₸`,
  save: "Сохранить",
  archive: "В архив",
  restore: "Вернуть",
  sectionCount: (n: number) => `${n}`,
  emptyCategory: "Материалов пока нет",
  empty: "Справочник пуст. Добавьте первый материал",
  archiveTitle: "Архив",
  archiveHint: "Материалы из архива не входят в расчёт вилки.",

  validation: {
    category: "Выберите категорию",
    unit: "Выберите единицу",
    name: "Название — от 2 до 80 символов",
    price: "Укажите цену в тенге: целое число больше нуля",
    segments: "Отметьте хотя бы один уровень",
  },

  errors: {
    nameTaken: "Такой материал в этой категории и единице уже есть — в списке или в архиве",
    priceChanged: "Цену уже изменили. Обновите страницу",
    archived: "Материал в архиве. Сначала верните его",
  },

  /** Мастер заявки, шаг «Какой уровень?»: вилка по ценам материалов. */
  hint: {
    price: (range: string) => `Примерно по материалам: ${range}`,
    note: "Вилка — по средним ценам материалов в справочнике площадки, с работой и монтажом. Точную цену назовут исполнители.",
    typicalSize: (size: string) => `Размеры не указаны — посчитано примерно, для типового размера: ${size}.`,
    sizeLm: (widthCm: number) => `длина ${widthCm} см`,
    sizeFront: (widthCm: number, heightCm: number) => `${widthCm} × ${heightCm} см`,
    demo: "Цены материалов демонстрационные.",
  },
} as const;
