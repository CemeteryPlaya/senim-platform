import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAND_PHOTO_KEYS, standHeroPhotos, standPhoto, standPhotoRecords, standPhotosByType } from "./stand-photos";

const DIR = path.resolve("public/stand-photos");
const MAX_FILE = 250 * 1024;
const MAX_TOTAL = 8 * 1024 * 1024;

describe("манифест временных фото стенда", () => {
  const records = standPhotoRecords();

  it("список ключей в коде совпадает с манифестом, ключи не повторяются", () => {
    expect(records.map((r) => r.key).sort()).toEqual([...STAND_PHOTO_KEYS].sort());
    expect(new Set(records.map((r) => r.file)).size).toBe(records.length);
    expect(records.length).toBeGreaterThanOrEqual(30);
    expect(records.length).toBeLessThanOrEqual(50);
  });

  it("каждый файл на месте, это WebP, размер и sha256 из манифеста верны, ≤ 250 КБ", () => {
    for (const r of records) {
      const file = path.join(DIR, r.file);
      expect(existsSync(file), r.file).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 4).toString("ascii"), r.file).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii"), r.file).toBe("WEBP");
      expect(bytes.length, r.file).toBe(r.size);
      expect(createHash("sha256").update(bytes).digest("hex"), r.file).toBe(r.sha256);
      expect(bytes.length, r.file).toBeLessThanOrEqual(MAX_FILE);
      expect(r.width).toBeGreaterThanOrEqual(1000);
    }
  });

  it("в папке нет лишних файлов и суммарный вес ≤ 8 МБ", () => {
    const files = readdirSync(DIR).filter((f) => f !== "manifest.json");
    expect(files.sort()).toEqual(records.map((r) => r.file).sort());
    const total = files.reduce((sum, f) => sum + statSync(path.join(DIR, f)).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL);
  });

  it("у каждого снимка лицензия, автор, ссылка на источник и отметка «временное»", () => {
    for (const r of records) {
      expect(r.temporary, r.key).toBe(true);
      expect(r.source, r.key).toBe("Unsplash");
      expect(r.license, r.key).toBe("Unsplash License");
      expect(r.author, r.key).toMatch(/^@\S+$/);
      expect(r.authorUrl, r.key).toBe(`https://unsplash.com/${r.author}`);
      expect(r.url, r.key).toMatch(/^https:\/\/unsplash\.com\/photos\/\S+$/);
      expect(r.unsplashId, r.key).toMatch(/^photo-/);
      expect(r.alt.length, r.key).toBeGreaterThan(5);
    }
  });

  it("чтение: standPhoto, список по типу, герои", () => {
    const k = standPhoto("kitchen-sage");
    expect(k).toMatchObject({ src: "/stand-photos/kitchen-sage.webp", storageKey: "stand-photos/kitchen-sage.webp", type: "kitchen" });
    expect(standPhotosByType("kitchen", "portfolio").map((p) => p.key)).toEqual(["kitchen-sage", "kitchen-island-oak", "kitchen-neoclassic", "kitchen-terracotta"]);
    for (const type of ["kitchen", "wardrobe", "walk-in-closet", "hallway", "bathroom"]) expect(standPhotosByType(type).length, type).toBeGreaterThanOrEqual(2);
    // «Ход работ» — процесс (цех, сборка, монтаж), а не чужая готовая мебель: снимки process-* мастерской.
    expect(standPhotosByType("workshop", "report").map((p) => p.key).every((k) => k.startsWith("process-"))).toBe(true);
    expect(standPhotosByType("workshop", "report").length).toBeGreaterThanOrEqual(4);
    const heroes = standHeroPhotos();
    expect(heroes.length).toBeGreaterThanOrEqual(2);
    for (const h of heroes) expect(h.width, h.key).toBeGreaterThan(h.height);
    expect(() => standPhoto("нет" as never)).toThrow();
  });
});
