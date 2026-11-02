import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brand } from "./brand";

const SRC = path.join(__dirname, "..");
const SKIP = new Set([path.join(SRC, "generated"), path.join(SRC, "config", "brand.ts")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (SKIP.has(full)) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Строки кода без комментариев: имя в пояснениях не попадает к пользователю. */
const codeLines = (text: string) =>
  text.split("\n").filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));

describe("название продукта — только из src/config/brand.ts", () => {
  it("в коде src/ нет захардкоженного имени", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      codeLines(readFileSync(file, "utf8"))
        .filter((line) => line.includes(brand.name))
        .map((line) => `${path.relative(SRC, file)}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("сервис-воркер не держит имя: офлайн-страницу собирает сервер из конфига", () => {
    const sw = codeLines(readFileSync(path.join(SRC, "..", "public", "sw.js"), "utf8"));
    expect(sw.filter((line) => line.includes(brand.name))).toEqual([]);
  });
});
