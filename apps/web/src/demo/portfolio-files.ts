import { standPhoto, type StandPhotoKey } from "@/platform/stand-photos";

/**
 * Файлы демо — временные фото мебели из public/stand-photos (описание — manifest.json, читает platform/stand-photos).
 * Метаданные берутся из манифеста, а не с диска: на Vercel папки public нет в файловой системе функции.
 * Портфолио публично: его файл лежит в хранилище static (ключ — путь внутри public/), сид пишет StoredFile без байтов.
 * Фото отчётов и сдачи приватны: сид загружает их байты через files (deals.ts), static для них не используется.
 */
export type PortfolioFileKey = Extract<
  StandPhotoKey,
  | "bathroom-walnut" | "bedroom-beige" | "closet-light" | "closet-walnut" | "dresser-oak" | "dresser-white"
  | "hallway-graphite" | "hallway-sonoma" | "kids-bunk" | "kitchen-island-oak" | "kitchen-neoclassic" | "kitchen-sage"
  | "kitchen-terracotta" | "office-walnut" | "office-white" | "shelving-loft" | "table-karagach" | "tv-zone-scandi"
  | "wardrobe-oak" | "wardrobe-white"
>;

/** Фото отчётов и сдачи: у каждого отчёта и сделки свои файлы (storageKey уникален). */
export type ReportPhotoKey = Extract<StandPhotoKey, `report-${string}`>;

export type DemoFileKey = PortfolioFileKey | ReportPhotoKey;

/** Данные StoredFile для файла демо в хранилище static (у фото отчётов и сдачи берётся только storageKey — путь к байтам). */
export function demoFile(key: DemoFileKey) {
  const p = standPhoto(key);
  return { storageKey: p.storageKey, provider: "static", contentType: "image/webp", size: p.size, sha256: p.sha256, width: p.width, height: p.height } as const;
}
