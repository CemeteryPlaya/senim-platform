import "server-only";
import screensJson from "../../../../../public/app-screens/manifest.json";
import { standPhoto, type StandPhotoKey } from "@/platform/stand-photos";
import { DEFAULT_FURNITURE_TYPES } from "@/verticals/furniture";
import { to } from "../../_shell/paths";

/**
 * Картинки лендинга гостя. Фото мебели — из манифеста стенда (временные, лицензия Unsplash: заменятся работами
 * партнёров одним шагом в манифесте); снимки наших экранов — из public/app-screens/manifest.json (временные, пересъёмка
 * после пересмотра вида). Клиентским компонентам отдаются только src, размеры и alt.
 */

/** Картинка для next/image: адрес статики и размеры (без сдвига раскладки). */
export type LandingImage = { src: string; width: number; height: number; alt: string };

/** Фото первого экрана и временное ли оно (от этого — подпись). */
export type HeroPhoto = LandingImage & { temporary: boolean };

/** Плитка ленты работ: фото, тип мебели и ссылка в каталог с этим типом. */
export type WorkTile = { key: string; image: LandingImage; title: string; href: string };

const HERO_KEY: StandPhotoKey = "hero-kitchen-oak";

/** Лента работ: лучшие кадры по разным типам мебели (отчёт V3, «Лучшие кадры»). */
const WORK_KEYS: readonly StandPhotoKey[] = [
  "kitchen-island-oak",
  "bedroom-beige",
  "kids-bunk",
  "office-white",
  "bathroom-walnut",
  "tv-zone-scandi",
  "shelving-loft",
  "kitchen-neoclassic",
];

const TYPE_NAMES = new Map<string, string>(DEFAULT_FURNITURE_TYPES.map((t) => [t.slug, t.name]));

export function heroPhoto(): HeroPhoto {
  const p = standPhoto(HERO_KEY);
  return { src: p.src, width: p.width, height: p.height, alt: p.alt, temporary: p.temporary };
}

export function workTiles(): WorkTile[] {
  return WORK_KEYS.map((key) => {
    const p = standPhoto(key);
    return {
      key,
      image: { src: p.src, width: p.width, height: p.height, alt: p.alt },
      title: TYPE_NAMES.get(p.type) ?? p.alt,
      href: to(`/catalog?type=${p.type}`),
    };
  });
}

/** Снимки экранов к шагам «Как это работает» — по порядку шагов; alt — из текстов шагов. */
export function stepScreens(alts: readonly string[]): LandingImage[] {
  return screensJson.screens.map((s, i) => ({ src: `/app-screens/${s.file}`, width: s.width, height: s.height, alt: alts[i] ?? "" }));
}
