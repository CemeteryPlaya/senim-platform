import manifestJson from "../../public/stand-photos/manifest.json";

/**
 * Временные фото мебели для стенда и показа (лицензия Unsplash): файлы лежат в public/stand-photos/,
 * описание — в manifest.json рядом. Сид кладёт их в портфолио, «Ход работ» и сдачу (провайдер static),
 * лендинг и плитки выбора берут их как обычную статику. Реальные работы партнёров заменят эти файлы.
 */

export const STAND_PHOTOS_DIR = "stand-photos";

/** Для чего снимок: портфолио мастеров сида, фото отчётов и сдачи, «герой» лендинга, запас для плиток. */
export type StandPhotoUse = "portfolio" | "report" | "hero" | "extra";

export const STAND_PHOTO_KEYS = [
  "kitchen-sage", "kitchen-island-oak", "kitchen-neoclassic", "kitchen-terracotta",
  "wardrobe-oak", "wardrobe-white", "closet-walnut", "closet-light",
  "hallway-graphite", "hallway-sonoma", "kids-bunk", "bedroom-beige", "tv-zone-scandi", "bathroom-walnut",
  "office-white", "office-walnut", "table-karagach", "shelving-loft", "dresser-oak", "dresser-white",
  "report-kitchen-1", "report-kitchen-2", "report-kitchen-3", "report-kitchen-4",
  "report-wardrobe-1", "report-wardrobe-2", "report-closet-1", "report-closet-2",
  "report-kids-1", "report-tv-1", "report-office-1", "report-table-1",
  "hero-kitchen-oak", "hero-kitchen-white",
  "hallway-storage", "bathroom-vanity", "dresser-retro", "workshop-bench", "workshop-hall",
] as const;
export type StandPhotoKey = (typeof STAND_PHOTO_KEYS)[number];

/** Запись манифеста: файл, тип мебели (slug справочника; для мастерской — workshop), источник и права. */
export type StandPhotoRecord = {
  key: StandPhotoKey;
  file: string;
  type: string;
  use: StandPhotoUse;
  /** Русское описание снимка для alt. */
  alt: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
  source: string;
  license: string;
  author: string;
  authorUrl: string;
  url: string;
  unsplashId: string;
  temporary: true;
};

/** Снимок для экрана: адрес статики и авторство (подпись автора — по условиям лицензии не обязательна, но данные есть). */
export type StandPhoto = StandPhotoRecord & {
  /** Адрес для next/image и <img>: статика из public/. */
  src: string;
  /** Ключ хранилища static (путь внутри public/) — им сид записывает StoredFile. */
  storageKey: string;
};

const RECORDS = (manifestJson as { photos: StandPhotoRecord[] }).photos;
const BY_KEY = new Map<string, StandPhoto>(
  RECORDS.map((r) => [r.key, { ...r, src: `/${STAND_PHOTOS_DIR}/${r.file}`, storageKey: `${STAND_PHOTOS_DIR}/${r.file}` }]),
);

/** Весь манифест по порядку файла. */
export const standPhotoRecords = (): readonly StandPhotoRecord[] => RECORDS;

/** Снимок по ключу; неизвестный ключ — ошибка (тест манифеста сверяет список ключей с файлом). */
export function standPhoto(key: StandPhotoKey): StandPhoto {
  const photo = BY_KEY.get(key);
  if (!photo) throw new Error(`Нет фото стенда: ${key}`);
  return photo;
}

/** Снимки типа мебели (slug справочника: kitchen, wardrobe, walk-in-closet, hallway…), по порядку манифеста; use сужает назначение. */
export function standPhotosByType(type: string, use?: StandPhotoUse): StandPhoto[] {
  return [...BY_KEY.values()].filter((p) => p.type === type && (use === undefined || p.use === use));
}

/** «Герои» для первого экрана лендинга: горизонтальные кадры, тёплый свет. */
export const standHeroPhotos = (): StandPhoto[] => [...BY_KEY.values()].filter((p) => p.use === "hero");
