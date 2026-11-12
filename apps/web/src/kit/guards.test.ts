/**
 * Сторожа цельности нового интерфейса (v2): статические проверки текста исходников в `src/kit/**` и
 * `src/app/(app)/**`. Старый интерфейс (`src/ui/**`, `src/app/(legacy)/**`) сюда не входит и не сканируется.
 *
 * У каждого правила — функция-детектор (текст → найденные места), самопроверка (нарушение ловится, чистая строка нет)
 * и обход дерева. Сообщение об ошибке называет файл и строку.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";

// ---------------------------------------------------------------------------------------------------------------------
// Обход дерева
// ---------------------------------------------------------------------------------------------------------------------

const SRC = fileURLToPath(new URL("../", import.meta.url));

type SourceFile = { rel: string; ext: ".ts" | ".tsx"; text: string };

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
}

/** Файлы v2: .ts/.tsx из kit и (app), кроме тестов и `tokens.ts` (единственный дом hex-значений). */
function collect(roots: string[]): SourceFile[] {
  const all: string[] = [];
  for (const root of roots) walk(path.join(SRC, root), all);
  return all
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => path.basename(f) !== "tokens.ts")
    .sort()
    .map((f) => ({
      rel: path.relative(path.join(SRC, ".."), f).split(path.sep).join("/"),
      ext: f.endsWith(".tsx") ? (".tsx" as const) : (".ts" as const),
      text: readFileSync(f, "utf8"),
    }));
}

const KIT_AND_APP = collect(["kit", "app/(app)"]);
const APP_ONLY = collect(["app/(app)"]);
const KIT_ONLY = collect(["kit"]);

// ---------------------------------------------------------------------------------------------------------------------
// Разбор текста
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Заменяет комментарии (строчные, блочные, JSX-комментарии) пробелами, сохраняя переводы строк, чтобы номера строк
 * не съехали. Строки в кавычках и шаблонные строки не трогает. Одиночные и двойные кавычки не переходят через конец
 * строки: апостроф в тексте JSX не должен «съесть» остальной файл.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let mode: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") {
        mode = "line";
        out += "  ";
        i += 2;
      } else if (c === "/" && n === "*") {
        mode = "block";
        out += "  ";
        i += 2;
      } else {
        if (c === "'" || c === '"' || c === "`") mode = c;
        out += c;
        i += 1;
      }
    } else if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      } else out += " ";
      i += 1;
    } else if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        out += "  ";
        i += 2;
      } else {
        out += c === "\n" ? "\n" : " ";
        i += 1;
      }
    } else {
      // внутри строки
      if (c === "\\") {
        out += c + (n ?? "");
        i += 2;
        continue;
      }
      if (c === mode || (c === "\n" && mode !== "`")) mode = "code";
      out += c;
      i += 1;
    }
  }
  return out;
}

type Hit = { line: number; text: string };

/** Находит все совпадения регулярного выражения построчно; `text` — найденный фрагмент. */
function matchLines(src: string, re: RegExp): Hit[] {
  const hits: Hit[] = [];
  const rows = src.split("\n");
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  for (let idx = 0; idx < rows.length; idx += 1) {
    for (const m of rows[idx].matchAll(new RegExp(re.source, flags))) {
      hits.push({ line: idx + 1, text: m[0].trim() });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------------------------------
// Детекторы (на вход — текст файла; комментарии вырезаются внутри)
// ---------------------------------------------------------------------------------------------------------------------

/** 1. Вес шрифта не выше 600. */
export function findHeavyFont(src: string): Hit[] {
  return matchLines(stripComments(src), /(?<![\w-])font-(?:bold|extrabold|black)(?![\w-])/);
}

/** 2. Сырые цвета: hex (#rgb, #rgba, #rrggbb, #rrggbbaa) и rgb()/hsl()/oklch(). Якорь `href="#abc"` — не цвет. */
export function findRawColor(src: string): Hit[] {
  const code = stripComments(src).replace(/href\s*=\s*\{?\s*["'`]#\w*/g, (m) => " ".repeat(m.length));
  return [
    ...matchLines(code, /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/),
    ...matchLines(code, /(?<![\w-])(?:rgba?|hsla?|oklch)\(/),
  ].sort((a, b) => a.line - b.line);
}

/**
 * 3. Произвольные значения Tailwind: класс вида `<имя>-[...]` (text-[15px], rounded-[10px], bg-[#fff], shadow-[0_1px_2px],
 * scale-[.97] и любой другой). Произвольный вариант `data-[state=open]:…` (после скобок идёт «:») — не значение, разрешён.
 * Индексация `items[0]` и вычитание `a - [1]` не совпадают: перед «-[» должно стоять слово без пробела,
 * а само слово — начинаться после пробела, кавычки или двоеточия варианта.
 */
export function findArbitraryValue(src: string): Hit[] {
  return matchLines(
    stripComments(src),
    /(?<=^|[\s"'`:!(])[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]\s"'`]+\](?!:)/,
  );
}

/** 4. Запрещённые импорты: `@/ui…`, `@/app/(legacy)…`, относительные пути в `(legacy)`. */
export function findLegacyImport(src: string): Hit[] {
  return matchLines(
    stripComments(src),
    /["'`](?:@\/ui(?:\/[^"'`]*)?|@\/app\/\(legacy\)[^"'`]*|(?:\.{1,2}\/)+[^"'`]*\(legacy\)[^"'`]*)["'`]/,
  );
}

/** 5. Сырые интерактивные теги вместо компонентов `@/kit`. */
export function findRawControl(src: string): Hit[] {
  return matchLines(stripComments(src), /<(?:button|input|select|textarea)(?![\w-])/);
}

/**
 * 6. Адрес-строка в href: `href="/…"`, `href='/…'`, `href={"/…"}`, `href={'/…'}`, `href={`/…`}`.
 * Разрешены `href={to(...)}`, `href={legacy(...)}`, `href="#…"`, `mailto:`, `tel:`, `https://`.
 */
export function findHardcodedHref(src: string): Hit[] {
  return matchLines(stripComments(src), /\bhref\s*=\s*(?:\{\s*)?["'`]\//);
}

/** 7. Кириллица вне комментариев (строки, текст JSX, имена). Комментарии по-русски разрешены. */
export function findCyrillic(src: string): Hit[] {
  return matchLines(stripComments(src), /[Ѐ-ӿ]+/);
}

/** 8. Слово «демо» в текстах: значения строк дерева (и результаты функций), без учёта регистра. */
export function findDemoWord(tree: unknown, trail = "ru.app"): string[] {
  const found: string[] = [];
  if (typeof tree === "string") {
    if (/демо/i.test(tree)) found.push(`${trail}: «${tree}»`);
  } else if (typeof tree === "function") {
    for (const arg of [0, 1, 2, 5, 11, 21]) {
      let result: unknown;
      try {
        result = (tree as (n: number) => unknown)(arg);
      } catch {
        continue;
      }
      found.push(...findDemoWord(result, `${trail}(${arg})`));
    }
  } else if (tree !== null && typeof tree === "object") {
    for (const [key, value] of Object.entries(tree)) found.push(...findDemoWord(value, `${trail}.${key}`));
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// Обход и сообщения
// ---------------------------------------------------------------------------------------------------------------------

function scan(files: SourceFile[], detect: (src: string) => Hit[], only?: ".tsx"): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (only && f.ext !== only) continue;
    for (const h of detect(f.text)) out.push(`${f.rel}:${h.line}  ${h.text}`);
  }
  return out;
}

function expectClean(rule: string, violations: string[]): void {
  expect(violations.join("\n"), `${rule}\n${violations.join("\n")}`).toBe("");
}

// ---------------------------------------------------------------------------------------------------------------------

describe("сторожа нового интерфейса: основа", () => {
  it("обход находит файлы kit и (app)", () => {
    expect(KIT_AND_APP.length).toBeGreaterThan(5);
    expect(APP_ONLY.some((f) => f.rel.endsWith("layout.tsx"))).toBe(true);
    expect(KIT_ONLY.some((f) => f.rel.endsWith("cn.ts"))).toBe(true);
    expect(KIT_AND_APP.some((f) => f.rel.endsWith("tokens.ts"))).toBe(false);
    expect(KIT_AND_APP.some((f) => /\.test\./.test(f.rel))).toBe(false);
  });

  it("вырезание комментариев сохраняет номера строк и не трогает строки", () => {
    const src = 'a // x\n/* b\nc */ d\n{/* e */}\n"// не комментарий"';
    const out = stripComments(src);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).toContain("// не комментарий");
    expect(out).not.toMatch(/[xbce]\s*\*?\//);
    expect(out.split("\n")[2]).toContain("d");
  });
});

describe("правило 1: вес шрифта не выше 600", () => {
  it("самопроверка", () => {
    expect(findHeavyFont('className="font-bold"')).toHaveLength(1);
    expect(findHeavyFont('className="text-body font-extrabold"')).toHaveLength(1);
    expect(findHeavyFont('className="font-black"')).toHaveLength(1);
    expect(findHeavyFont('className="font-semibold"')).toHaveLength(0);
    expect(findHeavyFont('className="font-medium"')).toHaveLength(0);
    expect(findHeavyFont("// font-bold нельзя")).toHaveLength(0);
  });
  it("в коде v2 нет font-bold, font-extrabold, font-black", () => {
    expectClean("Правило 1: вес шрифта не выше 600 (font-semibold).", scan(KIT_AND_APP, findHeavyFont));
  });
});

describe("правило 2: нет сырых цветов", () => {
  it("самопроверка", () => {
    expect(findRawColor('const c = "#fff"')).toHaveLength(1);
    expect(findRawColor('style={{ color: "#1a2b3c" }}')).toHaveLength(1);
    expect(findRawColor('"#1a2b3c4d"')).toHaveLength(1);
    expect(findRawColor('"#abcd"')).toHaveLength(1);
    expect(findRawColor('"rgb(0 0 0)"')).toHaveLength(1);
    expect(findRawColor('"rgba(0,0,0,.5)"')).toHaveLength(1);
    expect(findRawColor('"hsl(10 20% 30%)"')).toHaveLength(1);
    expect(findRawColor('<a href="#main">')).toHaveLength(0);
    expect(findRawColor('<a href="#add">')).toHaveLength(0);
    expect(findRawColor('"bg-surface text-ink"')).toHaveLength(0);
    expect(findRawColor('"&#8212;"')).toHaveLength(0);
    expect(findRawColor("// цвет #fff в комментарии")).toHaveLength(0);
    expect(findRawColor('"var(--color-canvas)"')).toHaveLength(0);
  });
  it("в .tsx нет hex, rgb() и hsl()", () => {
    expectClean(
      "Правило 2: цвета только из токенов (tokens.css / классы токенов).",
      scan(KIT_AND_APP, findRawColor, ".tsx"),
    );
  });
});

describe("правило 3: нет произвольных значений Tailwind", () => {
  it("самопроверка", () => {
    const bad = [
      "text-[15px]",
      "rounded-[10px]",
      "bg-[#fff]",
      "border-[#000]",
      "shadow-[0_1px_2px]",
      "scale-[.97]",
      "md:w-[calc(100%-2rem)]",
    ];
    for (const cls of bad) expect(findArbitraryValue(`className="flex ${cls}"`), cls).toHaveLength(1);
    expect(findArbitraryValue('className="text-body rounded-card"')).toHaveLength(0);
    expect(findArbitraryValue("const a = items[0];")).toHaveLength(0);
    expect(findArbitraryValue("const b = arr[i] - [1].length;")).toHaveLength(0);
    expect(findArbitraryValue("const c = arr.length-[1];")).toHaveLength(0);
    expect(findArbitraryValue('className="data-[state=open]:bg-surface"')).toHaveLength(0);
    expect(findArbitraryValue("// text-[15px] в комментарии")).toHaveLength(0);
  });
  it("в .tsx нет text-[…], rounded-[…], bg-[…], scale-[…] и других произвольных значений", () => {
    expectClean(
      "Правило 3: размеры, радиусы, цвета и тени — только токены.",
      scan(KIT_AND_APP, findArbitraryValue, ".tsx"),
    );
  });
});

describe("правило 4: нет импортов старого интерфейса", () => {
  it("самопроверка", () => {
    expect(findLegacyImport('import { X } from "@/ui/Button";')).toHaveLength(1);
    expect(findLegacyImport('import { X } from "@/ui";')).toHaveLength(1);
    expect(findLegacyImport('import { X } from "@/app/(legacy)/deals/page";')).toHaveLength(1);
    expect(findLegacyImport('import { X } from "../../(legacy)/x";')).toHaveLength(1);
    expect(findLegacyImport('const m = await import("@/ui/Modal");')).toHaveLength(1);
    expect(findLegacyImport('import { cn } from "@/kit/cn";')).toHaveLength(0);
    expect(findLegacyImport('import { ru } from "@/i18n/ru";')).toHaveLength(0);
    expect(findLegacyImport('import { x } from "@/uikit/a";')).toHaveLength(0);
  });
  it("kit и (app) не импортируют @/ui и @/app/(legacy)", () => {
    expectClean("Правило 4: v2 не зависит от v1.", scan(KIT_AND_APP, findLegacyImport));
  });
});

describe("правило 5: в экранах нет сырых элементов управления", () => {
  it("самопроверка", () => {
    expect(findRawControl("<button onClick={f}>")).toHaveLength(1);
    expect(findRawControl("<input type='text' />")).toHaveLength(1);
    expect(findRawControl("<select>")).toHaveLength(1);
    expect(findRawControl("<textarea />")).toHaveLength(1);
    expect(findRawControl("<Button onClick={f}>")).toHaveLength(0);
    expect(findRawControl("<Input />")).toHaveLength(0);
    expect(findRawControl("<buttons-group>")).toHaveLength(0);
    expect(findRawControl("{/* <button> только в kit */}")).toHaveLength(0);
  });
  it("в src/app/(app) нет <button>, <input>, <select>, <textarea>", () => {
    expectClean("Правило 5: в экранах — только компоненты из @/kit.", scan(APP_ONLY, findRawControl));
  });
});

describe("правило 6: адреса строятся через to() и legacy()", () => {
  it("самопроверка", () => {
    expect(findHardcodedHref('<Link href="/deals">')).toHaveLength(1);
    expect(findHardcodedHref("<Link href='/deals'>")).toHaveLength(1);
    expect(findHardcodedHref('<Link href={"/deals"}>')).toHaveLength(1);
    expect(findHardcodedHref("<Link href={'/deals'}>")).toHaveLength(1);
    expect(findHardcodedHref("<Link href={`/deals/${id}`}>")).toHaveLength(1);
    expect(findHardcodedHref('<Link href = "/deals">')).toHaveLength(1);
    expect(findHardcodedHref('<Link href={to("/deals")}>')).toHaveLength(0);
    expect(findHardcodedHref("<Link href={legacy(path)}>")).toHaveLength(0);
    expect(findHardcodedHref('<a href="#main">')).toHaveLength(0);
    expect(findHardcodedHref('<a href="mailto:a@b.kz">')).toHaveLength(0);
    expect(findHardcodedHref('<a href="tel:+77000000000">')).toHaveLength(0);
    expect(findHardcodedHref('<a href="https://example.kz">')).toHaveLength(0);
    expect(findHardcodedHref("<a href={href}>")).toHaveLength(0);
  });
  it("в src/app/(app) нет href со строкой-адресом", () => {
    expectClean("Правило 6: адрес — to(...) или legacy(...).", scan(APP_ONLY, findHardcodedHref));
  });
});

describe("правило 7: нет кириллицы в разметке и строках", () => {
  it("самопроверка", () => {
    expect(findCyrillic('const t = "Привет";')).toHaveLength(1);
    expect(findCyrillic("const t = 'Привет';")).toHaveLength(1);
    expect(findCyrillic("const t = `Привет ${n}`;")).toHaveLength(1);
    expect(findCyrillic("<p>Привет</p>")).toHaveLength(1);
    expect(findCyrillic('<p aria-label="Назад" />')).toHaveLength(1);
    expect(findCyrillic("<p>{t.hello}</p>")).toHaveLength(0);
    expect(findCyrillic("// Привет")).toHaveLength(0);
    expect(findCyrillic("/* Привет */ const a = 1;")).toHaveLength(0);
    expect(findCyrillic("{/* Привет */}")).toHaveLength(0);
    expect(findCyrillic("/**\n * Привет\n */\nconst a = 1;")).toHaveLength(0);
    expect(findCyrillic("/* а\nб */\nconst t = 'в';").map((h) => h.line)).toEqual([3]);
  });
  it("в .tsx из kit и (app) нет кириллицы вне комментариев", () => {
    expectClean(
      "Правило 7: тексты — только из ru.app (src/i18n/ru/app).",
      scan([...KIT_ONLY, ...APP_ONLY], findCyrillic, ".tsx"),
    );
  });
});

describe("правило 8: в ru.app нет слова «демо»", () => {
  it("самопроверка", () => {
    expect(findDemoWord({ a: "Демо-режим" })).toHaveLength(1);
    expect(findDemoWord({ a: { b: "это ДЕМО" } })).toHaveLength(1);
    expect(findDemoWord({ a: (n: number) => `демо ${n}` })).not.toHaveLength(0);
    expect(findDemoWord({ a: "Закрыть", b: { c: (n: number) => `Ещё ${n}` } })).toHaveLength(0);
  });
  it("значения ru.app не содержат «демо»", () => {
    expect(Object.keys(ru.app).length).toBeGreaterThan(0);
    expectClean("Правило 8: слова «демо» в интерфейсе нового вида нет.", findDemoWord(ru.app));
  });
});
