// Картинки плиток «Что нужно?» мастера заявки (public/img). Без серверного кода: нужны клиентской форме.

/** Иллюстрации плиток «Что нужно?» по slug справочника (частые типы — POPULAR_FURNITURE_TYPES вертикали). */
export const TYPE_IMAGES: Readonly<Record<string, string>> = {
  kitchen: "/img/kitchen.svg",
  wardrobe: "/img/wardrobe.svg",
  "walk-in-closet": "/img/closet.svg",
  hallway: "/img/hallway.svg",
  bathroom: "/img/bathroom.svg",
};

/** Плитка «Другое»: стол, детская, комод и остальное. */
export const OTHER_TYPE_IMAGE = "/img/table.svg";
