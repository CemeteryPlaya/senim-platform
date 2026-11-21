import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";

/**
 * У каждого кода события аудита есть русское название: оператор и администратор видят историю
 * сделки и журнал аудита, неизвестный код там показывается как есть («document.signing.started»).
 * Коды собираются из исходников: все строки вида «a.b» в выражении после `action:`.
 */
const ROOT = path.join(__dirname, "..", "src");
const SKIP = [path.join(ROOT, "generated"), path.join(ROOT, "gen"), path.join(ROOT, "i18n"), path.join(ROOT, "app", "(legacy)")];
const ACTION = /\baction:\s*((?:[^,"}\n]|"[^"\n]*")+)/g;
const CODE = /"([a-z_]+(?:\.[a-z_]+)+)"/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (SKIP.includes(full)) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function auditCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of sourceFiles(ROOT)) {
    const text = readFileSync(file, "utf8");
    if (!/audit/i.test(text)) continue;
    for (const [, expr] of text.matchAll(ACTION)) for (const [, code] of expr.matchAll(CODE)) codes.add(code);
  }
  return codes;
}

describe("названия событий аудита", () => {
  it("находит коды в исходниках, включая обе ветки условия", () => {
    const codes = auditCodes();
    expect(codes.has("deal.created")).toBe(true);
    expect(codes.has("furniture_type.hidden")).toBe(true);
    expect(codes.has("furniture_type.shown")).toBe(true);
  });

  it("у каждого кода есть русское название", () => {
    const labels = { ...ru.deal.history.action, ...ru.app.operatorDeals.audit.actions };
    const missing = [...auditCodes()].filter((code) => !labels[code]).sort();
    expect(missing).toEqual([]);
  });
});
