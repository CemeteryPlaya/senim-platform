import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Сторож этапа 5 (спека редизайна, раздел 9): демо-режима нет ни как возможности, ни как переменной. В исходниках
 * `src/` нет переменной, признаков, экранов и функций демо-режима. Сгенерированный код (`src/generated` — Prisma,
 * `src/gen` — buf) не проверяется: удалённые поля proto там остаются только как `reserved`. История миграций Prisma
 * (`prisma/migrations`) — история, её не переписывают. Исключения: этот файл и `env.test.ts` (проверяет, что лишняя
 * переменная DEMO_MODE ни на что не влияет).
 */
const WEB = path.join(__dirname, "..", "..");
const SRC = path.join(WEB, "src");
const SKIP = new Set([path.join(SRC, "generated"), path.join(SRC, "gen"), __filename, path.join(__dirname, "env.test.ts")]);

const FORBIDDEN = [
  "DEMO_MODE",
  "DEMO_ACCESS_PASSWORD",
  "isDemo",
  "demoMode",
  "isDemoMode",
  "assertDemoMode",
  "DemoBanner",
  "resetDemo",
  "resetDemoData",
  "resetIdentityDemo",
  "loginAsDemoPersona",
  "listDemoPersonas",
  "DemoPersona",
  "startDemoSession",
  "demoCode",
  "bankDemo",
  "getBankDemo",
  "seedDemo",
];
const PATTERN = new RegExp(`\\b(?:${FORBIDDEN.join("|")})\\b`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (SKIP.has(full)) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("демо-режима нет", () => {
  it("в src/ нет переменной, признаков и функций демо-режима", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (PATTERN.test(line) ? [`${path.relative(WEB, file)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  it("в src/ нет «demo» в именах экспортов (кроме сторожей, которые ищут это слово)", () => {
    // Сторож слова «демо» в текстах ru.app: имя называет то, что он ищет.
    const allowed = new Set(["findDemoWord"]);
    const exported = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;
    const offenders = sourceFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(exported)]
        .map((m) => m[1] ?? "")
        .filter((name) => /demo/i.test(name) && !allowed.has(name))
        .map((name) => `${path.relative(WEB, file)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("нет страниц демо-входа, показа банку и демо-настроек оператора", () => {
    for (const route of ["demo", "bank-demo", path.join("operator", "demo")]) {
      expect(existsSync(path.join(SRC, "app", "(legacy)", route)), route).toBe(false);
    }
    expect(existsSync(path.join(SRC, "demo")), "папка сида — src/seed").toBe(false);
  });

  it("в схеме Prisma нет признака isDemo", () => {
    expect(readFileSync(path.join(WEB, "prisma", "schema.prisma"), "utf8")).not.toMatch(/\bisDemo\b/);
  });
});
