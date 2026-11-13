import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// src/features — чистая логика, общая для v1 и v2: без экранов, без src/ui, без React-разметки и директив,
// без серверного кода в клиентском бандле.

const ROOT = __dirname;

type Use = { spec: string; typeOnly: boolean };

/** Все подключения модулей в тексте: import/export … from, побочный import, import("…"), require("…"). */
export function usesOf(text: string): Use[] {
  const uses: Use[] = [];
  // import|export [type] <что угодно, в том числе несколько строк> from "…"
  for (const m of text.matchAll(/\b(?:import|export)\s+(type\s+)?[^;"'`]*?\bfrom\s*(["'])([^"'\n]+)\2/g)) uses.push({ spec: m[3], typeOnly: Boolean(m[1]) });
  // побочный import "…"
  for (const m of text.matchAll(/\bimport\s*(["'])([^"'\n]+)\1/g)) uses.push({ spec: m[2], typeOnly: false });
  // динамический import("…") и require("…")
  for (const m of text.matchAll(/\b(?:import|require)\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g)) uses.push({ spec: m[2], typeOnly: false });
  return uses;
}

const FORBIDDEN: RegExp[] = [
  /^@\/ui(\/|$)/,
  /^@\/app(\/|$)/,
  /\(legacy\)/,
  /^(\.\.?\/)+(.*\/)?ui(\/|$)/,
  /^(\.\.?\/)+(.*\/)?app(\/|$)/,
  /^react-dom(\/|$)/,
];

/** Серверный код: в features только как типы (иначе попадёт в клиентский бандл). */
const TYPE_ONLY: RegExp[] = [/^@\/modules\//, /^@\/platform\//, /^@\/generated\//];

/**
 * Значимые (не type) импорты из TYPE_ONLY-зон, которые безопасны. Пока таких нет:
 * добавлять сюда спецификатор с пояснением, почему в нём нет серверных зависимостей.
 */
const VALUE_IMPORT_ALLOWED: ReadonlySet<string> = new Set<string>([]);

export function problemsOf(text: string): string[] {
  const out: string[] = [];
  for (const { spec, typeOnly } of usesOf(text)) {
    if (FORBIDDEN.some((re) => re.test(spec))) out.push(`запрещённый импорт: ${spec}`);
    else if (!typeOnly && TYPE_ONLY.some((re) => re.test(spec)) && !VALUE_IMPORT_ALLOWED.has(spec)) out.push(`только import type: ${spec}`);
    else if (!typeOnly && spec === "react") out.push("react — только import type");
  }
  if (/^\s*["']use (client|server)["']/m.test(text)) out.push("директива use client/server");
  return out;
}

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

  it.each(files.map((f) => [path.relative(ROOT, f), readFileSync(f, "utf8")] as const))("%s: без экранов, ui, серверных значений и директив", (_name, text) => {
    expect(problemsOf(text)).toEqual([]);
  });
});

describe("сторож ловит нарушения (самопроверка)", () => {
  const bad = [
    `import { a } from "@/ui";`,
    `import { a } from '@/ui/format';`,
    `import { a } from "@/app/(app)/x";`,
    `import { a } from "./(legacy)/x";`,
    `import { a } from "../ui/format";`,
    `import { a } from "../../../app/x";`,
    `export { a } from "../app/x";`,
    `import "@/ui/tokens.css";`,
    `const m = await import("@/ui");`,
    `const m = require('../ui/x');`,
    `import { a } from "react-dom";`,
    `import { db } from "@/platform/db";`,
    `import { a } from '@/modules/payments';`,
    `import { A } from "@/generated/prisma/enums";`,
    `import {\n  a,\n  type B,\n} from "@/modules/payments";`,
    `import { useState } from "react";`,
    `"use client";\nexport const a = 1;`,
  ];
  it.each(bad)("ловится: %s", (src) => {
    expect(problemsOf(src)).not.toEqual([]);
  });

  const good = [
    `import type { X } from "@/modules/payments";`,
    `import type {\n  A,\n  B,\n} from "@/modules/deal-core";`,
    `export type { X } from "@/platform/db";`,
    `import type { DealStatus } from "@/generated/prisma/enums";`,
    `import { ru } from "@/i18n/ru";`,
    `import { formatTiyn } from "@/features/format/format";`,
    `const { put } = await import("@vercel/blob/client");`,
    `import type { ReactNode } from "react";`,
    `import { a } from "./state";`,
    `import { a } from "../deal-money/money-panel";`,
  ];
  it.each(good)("не ловится: %s", (src) => {
    expect(problemsOf(src)).toEqual([]);
  });
});
