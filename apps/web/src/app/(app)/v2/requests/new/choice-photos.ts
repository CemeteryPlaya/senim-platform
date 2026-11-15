import "server-only";
import { standPhoto, type StandPhotoKey } from "@/platform/stand-photos";

/**
 * Фото плиток первого шага мастера заявки: тип мебели (slug справочника) → снимок стенда. Лучшие кадры по правке V3:
 * кухня — шалфейная с островом, шкаф-купе — белый до потолка, гардеробная, прихожая, ванная. Типов без хорошего снимка
 * здесь нет — плитка рисуется нейтральной заливкой со значком, без подделки. Только сервер: манифест стенда не уходит
 * в клиентский пакет, страница передаёт шагу готовые адреса.
 */
const CHOICE_PHOTO_KEYS: Readonly<Record<string, StandPhotoKey>> = {
  kitchen: "kitchen-sage",
  wardrobe: "wardrobe-white",
  "walk-in-closet": "report-closet-1",
  hallway: "hallway-sonoma",
  bathroom: "bathroom-walnut",
};

/** slug типа мебели → адрес снимка (`/stand-photos/<ключ>.webp`). */
export function choicePhotos(): Record<string, string> {
  return Object.fromEntries(Object.entries(CHOICE_PHOTO_KEYS).map(([slug, key]) => [slug, standPhoto(key).src]));
}
