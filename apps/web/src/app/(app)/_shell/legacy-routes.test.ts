import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { isLegacyRoute, LEGACY_ROUTES } from "./legacy-routes";

const LEGACY_DIR = join(__dirname, "..", "..", "(legacy)");

/** Адреса страниц дерева v1: каталоги с page.tsx, кроме ловушки `[...missing]` (она и есть 404). */
function legacyPages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith("[...")) found.push(...legacyPages(full));
    } else if (entry.name === "page.tsx") {
      const path = relative(LEGACY_DIR, dir).split(sep).filter(Boolean).join("/");
      found.push(`/${path}`);
    }
  }
  return found;
}

describe("экраны v1 для заглушки «раздел переносится»", () => {
  it("список совпадает со страницами (legacy)", () => {
    expect([...LEGACY_ROUTES].sort()).toEqual(legacyPages(LEGACY_DIR).sort());
  });

  it.each(["/inspiration", "/inspiration/abc", "/measurer/1", "/executor/measurements", "/executor/portfolio/from-deal/7", "/register", "/deals/1/money", "/"])(
    "%s — экран v1 есть",
    (path) => {
      expect(isLegacyRoute(path)).toBe(true);
    },
  );

  it.each(["/nope", "/deals/1/nope", "/inspiration/a/b", "/aboutx", "/operator/unknown"])("%s — экрана нет: «Страница не найдена»", (path) => {
    expect(isLegacyRoute(path)).toBe(false);
  });

  it("пустые сегменты не считаются", () => {
    expect(isLegacyRoute("//inspiration//")).toBe(true);
  });
});
