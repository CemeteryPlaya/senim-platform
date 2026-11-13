import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// src/features — чистая логика, общая для v1 и v2: без экранов, без src/ui, без React-разметки и директив.

const ROOT = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const files = sources(ROOT);

describe("src/features — нейтральная чистая логика", () => {
  it("файлы найдены", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), readFileSync(f, "utf8")] as const))("%s: без экранов, ui, react-dom и директив", (_name, text) => {
    expect(text).not.toMatch(/from\s+["'](@\/app\/|@\/ui[/"]|[./]+\/.*\(legacy\)|react-dom)/);
    expect(text).not.toMatch(/\(legacy\)/);
    expect(text).not.toMatch(/^\s*["']use (client|server)["']/m);
  });

  it("React допустим только типами", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']react["']/m);
    }
  });
});
