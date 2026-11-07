// Иллюстрации типов мебели (public/img/*.svg) — заглушки на месте фото, пока у заявки и работы нет своих.
// Подбираются по названию типа мебели; нет совпадения — null (карточка покажет спокойную заглушку).

const BY_KEYWORD: readonly [keyword: string, file: string][] = [
  ["кухн", "kitchen"],
  ["гардероб", "closet"],
  ["прихож", "hallway"],
  ["ванн", "bathroom"],
  ["санузел", "bathroom"],
  ["детск", "kids"],
  ["стол", "table"],
  ["кабинет", "office"],
  ["офис", "office"],
  ["шкаф", "wardrobe"],
];

/** Путь к иллюстрации для названия («Кухня угловая» → /img/kitchen.svg) или null. */
export function illustrationFor(title: string): string | null {
  const lower = title.toLowerCase();
  const hit = BY_KEYWORD.find(([keyword]) => lower.includes(keyword));
  return hit ? `/img/${hit[1]}.svg` : null;
}

/** То же в виде пропса image карточки с фото (PhotoCard): иллюстрация или заглушка. */
export function photo(title: string): { src: string } | null {
  const src = illustrationFor(title);
  return src ? { src } : null;
}

/** Иллюстрация по ключу файла (лендинг): kitchen → /img/kitchen.svg. */
export const illustration = (key: string): string => `/img/${key}.svg`;
