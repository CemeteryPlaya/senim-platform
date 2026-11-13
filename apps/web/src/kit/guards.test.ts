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

/** Файлы v2: .ts/.tsx из kit и (app), кроме тестов (с `withTests` — вместе с ними) и `tokens.ts` (единственный дом hex-значений). */
function collect(roots: string[], withTests = false): SourceFile[] {
  const all: string[] = [];
  for (const root of roots) {
    const full = path.join(SRC, root);
    if (statSync(full).isDirectory()) walk(full, all);
    else all.push(full);
  }
  return all
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => withTests || !/\.test\.tsx?$/.test(f))
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
/** Весь src, кроме kit (для правила 10): v1, модули, платформа и v2. */
const OUTSIDE_KIT = collect(readdirSync(SRC).filter((name) => name !== "kit"));
/** То же вместе с тестами (правило 11: тесты тоже берут kit из `@/kit`, кроме test-utils). */
const OUTSIDE_KIT_WITH_TESTS = collect(
  readdirSync(SRC).filter((name) => name !== "kit"),
  true,
);

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

/** 1. Вес шрифта не выше 600: классы font-bold/extrabold/black и `fontWeight: 700|800|900|"bold"|"bolder"` в стиле. */
export function findHeavyFont(src: string): Hit[] {
  const code = stripComments(src);
  return [
    ...matchLines(code, /(?<![\w-])font-(?:bold|extrabold|black)(?![\w-])/),
    ...matchLines(code, /\bfontWeight\s*:\s*(?:[789]00\b|["'`](?:bold|bolder|[789]00)["'`])/),
  ].sort((a, b) => a.line - b.line);
}

/** 2. Сырые цвета: hex (#rgb, #rgba, #rrggbb, #rrggbbaa) и rgb()/hsl()/oklch(). Якоря `href="#abc"`, `href: "#abc"` и `url(#abc)` — не цвет. */
export function findRawColor(src: string): Hit[] {
  const code = stripComments(src).replace(/(?:href\s*[=:]\s*\{?\s*["'`]#|url\(\s*["']?#)\w*/g, (m) => " ".repeat(m.length));
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
  const code = stripComments(src);
  return [
    ...matchLines(code, /(?<=^|[\s"'`:!(])-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]\s]+\](?!:)/),
    // Сокращённая форма Tailwind 4: `max-w-(--x)`, `text-(--x)`, `bg-(color:--x)`. Разрешены только переменные
    // времени выполнения библиотек окон — `--radix-*` и `--vaul-*` (их значения считает библиотека, токена нет).
    ...matchLines(code, /(?<=^|[\s"'`:!])-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\((?![a-z-]*:?--(?:radix|vaul)-)[^)\s]*--[^)\s]*\)(?!:)/),
  ].sort((a, b) => a.line - b.line);
}

/**
 * 4. Запрещённые импорты (import, import(), require): `@/ui…`, `@/app/(legacy)…`, относительные пути в старый
 * `ui` (`../ui`, `../../ui/x`) и любой относительный путь с `(legacy)`.
 */
export function findLegacyImport(src: string): Hit[] {
  return matchLines(
    stripComments(src),
    /["'`](?:@\/ui(?:\/[^"'`]*)?|@\/app\/\(legacy\)[^"'`]*|(?:\.\.\/)+ui(?:\/[^"'`]*)?|(?:\.{1,2}\/)+[^"'`]*\(legacy\)[^"'`]*)["'`]/,
  );
}

/** 5. Сырые интерактивные теги вместо компонентов `@/kit`. */
export function findRawControl(src: string): Hit[] {
  return matchLines(stripComments(src), /<(?:button|input|select|textarea)(?![\w-])/);
}

/**
 * 6. Адрес-литерал вместо to()/legacy(): `href="/…"`, `href={"/…"}`, `` href={`/…`} ``, ветка условия
 * `href={c ? "/a" : "/b"}` (также `??`, `||`), ключ объекта `href: "/…"`, вызовы `redirect("/…")`,
 * `permanentRedirect("/…")`, а также `router.push|replace|prefetch("/…")` и `router?.push(…)`, деструктуризация
 * `const { push } = useRouter()` и объектная форма `href={{ pathname: "/…" }}`. Вызовы без приёмника `router`
 * (`url.replace("/v2", "")`, `arr.push("/x")`) — обычный код; выражение в `href={…}`, начинающееся с `to(` или
 * `legacy(`, пропускается целиком. Разрешены `to(...)`, `legacy(...)`, `#…`, `mailto:`, `tel:`, `https://`.
 */
export function findHardcodedHref(src: string): Hit[] {
  const code = stripComments(src);
  return [
    ...matchLines(code, /\bhref\s*=\s*(?:\{\s*)?["'`]\//),
    ...matchLines(code, /\bhref\s*=\s*\{(?!\s*(?:to|legacy)\()[^}\n]*(?:\?\??|:|\|\|)\s*["'`]\//),
    ...matchLines(code, /\bhref\s*:\s*["'`]\//),
    ...matchLines(code, /\b(?:redirect|permanentRedirect)\s*\(\s*["'`]\//),
    ...matchLines(code, /\brouter\s*\??\.\s*(?:push|replace|prefetch)\s*\(\s*["'`]\//),
    // Обход приёмника: `const { push } = useRouter()` — дальше `push("/…")` не отличить от обычного вызова.
    ...matchLines(code, /\{[^}\n]*\b(?:push|replace|prefetch)\b[^}\n]*\}\s*=\s*useRouter\s*\(/),
    // Объектная форма адреса: `href={{ pathname: "/…" }}`.
    ...matchLines(code, /\bpathname\s*:\s*["'`]\//),
  ]
    .sort((a, b) => a.line - b.line)
    // Одна запись на строку: `href={{ pathname: "/x" }}` ловят сразу два шаблона.
    .filter((hit, i, all) => i === 0 || hit.line !== all[i - 1].line);
}

/** 7. Кириллица вне комментариев (строки, текст JSX, имена). Комментарии по-русски разрешены. */
export function findCyrillic(src: string): Hit[] {
  return matchLines(stripComments(src), /[Ѐ-ӿ]+/);
}

/**
 * 9. Адаптивность по ширине окна вместо версии устройства: варианты Tailwind `sm:`, `md:`, `lg:`, `xl:`, `2xl:`
 * (и `max-*:`, `min-*:`, `min-[600px]:`), контейнерные запросы Tailwind 4 (`@md:`, `@max-md:`, `@[600px]:`,
 * `@min-[…]:`), а в коде — `@media (…width…)`, `matchMedia(…width…)` / `useMediaQuery(…width…)` с любой записью
 * условия (в том числе `(600px <= width)`) и чтение `innerWidth` / `outerWidth` / `clientWidth` / `screen.width`. Версии различают только `desktop:` и
 * `mobile:` (data-device на <html>). Вариант — это префикс, за которым сразу идёт класс: ключ объекта `sm: "…"` (с
 * пробелом после двоеточия), `size="sm"` и `text-sm` — не варианты.
 */
export function findWidthVariant(src: string): Hit[] {
  const code = stripComments(src);
  const variantEnd = String.raw`(?=:[\w!@[-])`;
  const start = String.raw`(?<=^|[\s"'\`:!(])`;
  return [
    ...matchLines(code, new RegExp(`${start}(?:(?:max|min)-)?(?:sm|md|lg|xl|[2-7]xl)${variantEnd}`)),
    ...matchLines(code, new RegExp(String.raw`${start}(?:max|min)-\[[^\]\s]+\]${variantEnd}`)),
    // Контейнерные запросы: @md:, @max-md:, @min-[600px]:, @[600px]:, @md/name:.
    ...matchLines(
      code,
      new RegExp(String.raw`${start}@(?:(?:max|min)-)?(?:[a-z0-9]+|\[[^\]\s]+\])(?:\/[\w-]+)?${variantEnd}`),
    ),
    ...matchLines(code, /(?:@media|(?:matchMedia|useMediaQuery)\s*\(\s*["'`])[^{"'`\n]*\bwidth\b/),
    ...matchLines(code, /\b(?:innerWidth|outerWidth|clientWidth)\b/),
    ...matchLines(code, /\bscreen\s*\.\s*(?:avail)?[wW]idth\b/),
  ].sort((a, b) => a.line - b.line);
}

/**
 * 10. Внутренний модуль kit снаружи: `button-styles` (там `lookClasses` без запрета `primary` + `sm`) импортируют только
 * файлы `src/kit`; остальной код берёт кнопки из `@/kit` (правило 11), где тип держит запрет.
 */
export function findKitInternalImport(src: string): Hit[] {
  return matchLines(stripComments(src), /["'`](?:@\/kit\/|(?:\.{1,2}\/)+(?:[^"'`]*\/)?kit\/)button-styles["'`]/);
}

/**
 * Модули kit, которых нет в `@/kit` намеренно: `theme` (cookies() из next/headers — только сервер), `fonts`
 * (next/font) и `tokens` (значения цветов для метаданных). В общем входе они притянули бы серверный код в клиентские
 * компоненты, импортирующие `@/kit`.
 */
const KIT_DIRECT_MODULES = ["theme", "fonts", "tokens"];

/**
 * 11. Код вне `src/kit` берёт kit только из `@/kit` (не `@/kit/Button`, не `../kit/cn`): внутреннее устройство kit
 * меняется, не трогая экраны. Исключения — KIT_DIRECT_MODULES, а в тестах ещё `@/kit/test-utils`.
 */
export function findKitDeepImport(src: string, isTest = false): Hit[] {
  const allowed = isTest ? [...KIT_DIRECT_MODULES, "test-utils"] : KIT_DIRECT_MODULES;
  return matchLines(stripComments(src), /["'`](?:@\/kit\/|(?:\.{1,2}\/)+(?:[^"'`]*\/)?kit\/)[^"'`]+["'`]/).filter((hit) => {
    const name = /kit\/([^"'`]+)["'`]$/.exec(hit.text)?.[1] ?? "";
    return !allowed.includes(name);
  });
}

/** 8. Слова «демо», «комисси…», «эскроу» в текстах: значения строк дерева (и результаты функций), без учёта регистра. */
export function findDemoWord(tree: unknown, trail = "ru.app"): string[] {
  const found: string[] = [];
  if (typeof tree === "string") {
    if (/демо|комисси|эскроу/i.test(tree)) found.push(`${trail}: «${tree}»`);
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

function scan(files: SourceFile[], detect: (src: string) => Hit[], skip: string[] = []): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (skip.some((s) => f.rel.endsWith(s))) continue;
    for (const h of detect(f.text)) out.push(`${f.rel}:${h.line}  ${h.text}`);
  }
  return out;
}

function expectClean(rule: string, violations: string[]): void {
  expect(violations, rule).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------------

describe("сторожа нового интерфейса: основа", () => {
  it("обход находит файлы kit и (app)", () => {
    expect(KIT_AND_APP.length).toBeGreaterThan(5);
    expect(APP_ONLY.some((f) => f.ext === ".tsx")).toBe(true);
    expect(APP_ONLY.some((f) => f.rel.endsWith("layout.tsx"))).toBe(true);
    expect(KIT_ONLY.some((f) => f.rel.endsWith("cn.ts"))).toBe(true);
    expect(KIT_AND_APP.some((f) => f.rel.endsWith("tokens.ts"))).toBe(false);
    expect(KIT_AND_APP.some((f) => /\.test\./.test(f.rel))).toBe(false);
    expect(OUTSIDE_KIT.some((f) => f.rel.startsWith("src/app/(app)/"))).toBe(true);
    expect(OUTSIDE_KIT.some((f) => f.rel === "src/proxy.ts")).toBe(true);
    expect(OUTSIDE_KIT.some((f) => f.rel.startsWith("src/kit/"))).toBe(false);
  });

  it("вырезание комментариев сохраняет номера строк и не трогает строки", () => {
    const src = 'a // x\n/* b\nc */ d\n{/* e */}\n"// не комментарий"';
    const out = stripComments(src);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).toContain("// не комментарий");
    expect(out).not.toMatch(/[xbce]\s*\*?\//);
    expect(out.split("\n")[2]).toContain("d");
  });

  it("https:// в строке сохраняется, в тексте JSX считается началом комментария (известное ограничение)", () => {
    const inString = stripComments('const u = "https://example.kz/Привет";');
    expect(inString).toContain("https://example.kz");
    expect(findCyrillic('const u = "https://example.kz/Привет";')).toHaveLength(1);
    // Текст JSX не размечается: «//» в нём режет остаток строки, число строк не меняется.
    const inJsx = stripComments("<a>https://example.kz</a>\n<b>x</b>");
    expect(inJsx.split("\n")).toHaveLength(2);
    expect(inJsx).not.toContain("</a>");
    expect(inJsx).toContain("<b>x</b>");
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
    expect(findHeavyFont("style={{ fontWeight: 700 }}")).toHaveLength(1);
    expect(findHeavyFont("{ fontWeight: 900 }")).toHaveLength(1);
    expect(findHeavyFont('{ fontWeight: "bold" }')).toHaveLength(1);
    expect(findHeavyFont("{ fontWeight: 'bolder' }")).toHaveLength(1);
    expect(findHeavyFont('{ fontWeight: "800" }')).toHaveLength(1);
    expect(findHeavyFont("{ fontWeight: 600 }")).toHaveLength(0);
    expect(findHeavyFont('{ fontWeight: "normal" }')).toHaveLength(0);
  });
  it("в коде v2 нет font-bold, font-extrabold, font-black и fontWeight выше 600", () => {
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
    expect(findRawColor('const n = { href: "#add" };')).toHaveLength(0);
    expect(findRawColor('<path fill="url(#fade)" />')).toHaveLength(0);
    expect(findRawColor('const s = { color: "#fff" };')).toHaveLength(1);
  });
  it("в .ts и .tsx нет hex, rgb() и hsl() (кроме tokens.ts)", () => {
    expectClean(
      "Правило 2: цвета только из токенов (tokens.css / классы токенов).",
      scan(KIT_AND_APP, findRawColor),
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
    // отрицательные утилиты и значения с кавычками
    for (const cls of ["-mt-[3px]", "md:-translate-x-[2px]", "font-['Inter']", "bg-[url('/x.png')]"]) {
      expect(findArbitraryValue(`className="flex ${cls}"`), cls).toHaveLength(1);
    }
    expect(findArbitraryValue('className="-mt-4 md:-translate-x-2 font-sans"')).toHaveLength(0);
    // сокращённая форма Tailwind 4 с переменной: ловится, кроме переменных Radix и vaul
    for (const cls of ["max-w-(--x)", "text-(--x)", "md:bg-(--brand)", "bg-(color:--x)", "-mt-(--gap)"]) {
      expect(findArbitraryValue(`className="flex ${cls}"`), cls).toHaveLength(1);
    }
    for (const cls of [
      "origin-(--radix-popover-content-transform-origin)",
      "max-w-(--radix-popover-content-available-width)",
      "h-(--vaul-drawer-height)",
    ]) {
      expect(findArbitraryValue(`className="flex ${cls}"`), cls).toHaveLength(0);
    }
    expect(findArbitraryValue("const n = f(--i);")).toHaveLength(0);
    expect(findArbitraryValue("const s = use-(x);")).toHaveLength(0);
  });
  it("в .ts и .tsx нет text-[…], rounded-[…], bg-[…], scale-[…] и других произвольных значений", () => {
    expectClean(
      "Правило 3: размеры, радиусы, цвета и тени — только токены.",
      scan(KIT_AND_APP, findArbitraryValue),
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
    expect(findLegacyImport('import { X } from "../ui/Button";')).toHaveLength(1);
    expect(findLegacyImport('import { X } from "../../ui";')).toHaveLength(1);
    expect(findLegacyImport('const m = require("@/ui/Modal");')).toHaveLength(1);
    expect(findLegacyImport('const m = await import("@/ui");')).toHaveLength(1);
    expect(findLegacyImport('import { X } from "../kit/ui-parts";')).toHaveLength(0);
    expect(findLegacyImport('import { X } from "./cn";')).toHaveLength(0);
    expect(findLegacyImport("// import x from '@/ui/Button'")).toHaveLength(0);
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
    // ключ объекта, вызовы навигации, условия
    expect(findHardcodedHref('const nav = [{ label: l.deals, href: "/deals" }];')).toHaveLength(1);
    expect(findHardcodedHref("const nav = { href: '/deals' };")).toHaveLength(1);
    expect(findHardcodedHref("const nav = { href: `/deals/${id}` };")).toHaveLength(1);
    expect(findHardcodedHref('redirect("/login");')).toHaveLength(1);
    expect(findHardcodedHref("redirect('/');")).toHaveLength(1);
    expect(findHardcodedHref("permanentRedirect(`/deals`);")).toHaveLength(1);
    expect(findHardcodedHref('router.push("/deals");')).toHaveLength(1);
    expect(findHardcodedHref("router.replace('/deals/1');")).toHaveLength(1);
    expect(findHardcodedHref('router.prefetch("/deals");')).toHaveLength(1);
    expect(findHardcodedHref('<Link href={ok ? "/a" : "/b"}>')).toHaveLength(1);
    expect(findHardcodedHref('<Link href={ok ? to("/a") : "/b"}>')).toHaveLength(1);
    expect(findHardcodedHref('<Link href={x ?? "/a"}>')).toHaveLength(1);
    expect(findHardcodedHref('const nav = { href: to("/deals") };')).toHaveLength(0);
    expect(findHardcodedHref('const nav = { href: "https://example.kz" };')).toHaveLength(0);
    expect(findHardcodedHref('redirect(to("/login"));')).toHaveLength(0);
    expect(findHardcodedHref('router.push(to("/deals"));')).toHaveLength(0);
    // router?.push, деструктуризация push из useRouter(), href-объект с pathname
    expect(findHardcodedHref('router?.push("/deals");')).toHaveLength(1);
    expect(findHardcodedHref("router?.replace('/deals');")).toHaveLength(1);
    expect(findHardcodedHref('router?.push(to("/deals"));')).toHaveLength(0);
    expect(findHardcodedHref("const { push } = useRouter();")).toHaveLength(1);
    expect(findHardcodedHref("const { replace, refresh } = useRouter();")).toHaveLength(1);
    expect(findHardcodedHref("const { refresh } = useRouter();")).toHaveLength(0);
    expect(findHardcodedHref("const router = useRouter();")).toHaveLength(0);
    expect(findHardcodedHref('<Link href={{ pathname: "/deals" }}>')).toHaveLength(1);
    expect(findHardcodedHref("<Link href={{pathname: `/deals/${id}`, query: {}}}>")).toHaveLength(1);
    expect(findHardcodedHref('<Link href={{ pathname: to("/deals") }}>')).toHaveLength(0);
    expect(findHardcodedHref('<Link href={ok ? to("/a") : legacy(p)}>')).toHaveLength(0);
    expect(findHardcodedHref('const s = path.replace("/", "-");')).toHaveLength(0);
    expect(findHardcodedHref('const u = url.replace("/v2", "");')).toHaveLength(0);
    expect(findHardcodedHref('const u = pathname.replace("/api/", "");')).toHaveLength(0);
    expect(findHardcodedHref('arr.push("/x");')).toHaveLength(0);
    expect(findHardcodedHref('if (path.startsWith("/")) {}')).toHaveLength(0);
    expect(findHardcodedHref('<Link href={to(c ? "/a" : "/b")}>')).toHaveLength(0);
    expect(findHardcodedHref('<Link href={to("/a", { q: "/x" })}>')).toHaveLength(0);
    expect(findHardcodedHref('<Link href={ legacy(c ? "/a" : "/b") }>')).toHaveLength(0);
    expect(findHardcodedHref('redirect("/x"); // redirect("/y")')).toHaveLength(1);
  });
  it("в src/app/(app) (.ts и .tsx) нет адресов-литералов", () => {
    expectClean(
      "Правило 6: адрес — to(...) или legacy(...).",
      scan(APP_ONLY, findHardcodedHref, ["_shell/paths.ts"]),
    );
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
    // сообщения схем и ошибок в .ts
    expect(findCyrillic('z.string().min(1, "Введите имя")')).not.toHaveLength(0);
    expect(findCyrillic('throw new Error("Не найдено");')).not.toHaveLength(0);
    expect(findCyrillic('z.string().min(1, ru.app.kit.close)')).toHaveLength(0);
  });
  it("в .ts и .tsx из kit и (app) нет кириллицы вне комментариев", () => {
    expectClean(
      "Правило 7: тексты — только из ru.app (src/i18n/ru/app).",
      scan([...KIT_ONLY, ...APP_ONLY], findCyrillic),
    );
  });
});

describe("правило 9: версии различают desktop: и mobile:, а не ширина окна", () => {
  it("самопроверка", () => {
    for (const cls of [
      "md:grid-cols-2",
      "sm:flex",
      "lg:px-6",
      "xl:gap-4",
      "2xl:max-w-content",
      "max-sm:hidden",
      "min-md:block",
      "dark:md:flex",
      "md:!p-4",
      "min-[600px]:flex",
      "max-[1023px]:hidden",
      "lg:[&>p]:mt-2",
      "@md:flex",
      "@lg:grid-cols-2",
      "@[600px]:flex",
      "@max-md:hidden",
      "@min-[30rem]:block",
      "@md/card:flex",
    ]) {
      expect(findWidthVariant(`className="flex ${cls}"`), cls).toHaveLength(1);
    }
    expect(findWidthVariant("cn(\"a\", 'md:grid-cols-2')")).toHaveLength(1);
    expect(findWidthVariant("const s = `@media (min-width: 600px) { }`;")).toHaveLength(1);
    expect(findWidthVariant("const s = `@media (max-width:600px)`;")).toHaveLength(1);
    expect(findWidthVariant("const s = `@media (width >= 40rem)`;")).toHaveLength(1);
    expect(findWidthVariant("const s = `@media (600px <= width)`;")).toHaveLength(1);
    expect(findWidthVariant('window.matchMedia("(min-width: 1024px)")')).toHaveLength(1);
    expect(findWidthVariant('matchMedia("(600px <= width <= 900px)")')).toHaveLength(1);
    expect(findWidthVariant('const wide = useMediaQuery("(min-width: 1024px)");')).toHaveLength(1);
    expect(findWidthVariant("const wide = useMediaQuery(`(width > 600px)`);")).toHaveLength(1);
    expect(findWidthVariant("if (window.innerWidth > 1024) {}")).toHaveLength(1);
    expect(findWidthVariant("const w = innerWidth;")).toHaveLength(1);
    expect(findWidthVariant("const w = window.outerWidth;")).toHaveLength(1);
    expect(findWidthVariant("const w = document.documentElement.clientWidth;")).toHaveLength(1);
    expect(findWidthVariant("if (el.clientWidth > 600) {}")).toHaveLength(1);
    expect(findWidthVariant("const w = screen.width;")).toHaveLength(1);
    expect(findWidthVariant("if (window.screen.width < 600) {}")).toHaveLength(1);
    expect(findWidthVariant("const clientWidthLabel = 1;")).toHaveLength(0);
    expect(findWidthVariant("const w = size.width;")).toHaveLength(0);
    expect(findWidthVariant("const screenWidthLabel = 1;")).toHaveLength(0);
    // Не варианты по ширине.
    expect(findWidthVariant('<Button variant="quiet" size="sm">')).toHaveLength(0);
    expect(findWidthVariant('const s = { sm: "a", md: "b" };')).toHaveLength(0);
    expect(findWidthVariant('className="text-sm"')).toHaveLength(0);
    expect(findWidthVariant('className="@container"')).toHaveLength(0);
    expect(findWidthVariant('const e = "a@b.kz";')).toHaveLength(0);
    expect(findWidthVariant('useMediaQuery("(prefers-reduced-motion: reduce)")')).toHaveLength(0);
    expect(findWidthVariant("const innerWidthLabel = 1;")).toHaveLength(0);
    expect(findWidthVariant("const w = window.screen.availWidth;")).toHaveLength(1);
    for (const cls of [
      "desktop:grid-cols-2",
      "mobile:min-h-control",
      "has-checked:border-action",
      "hover:opacity-90",
      "min-h-control",
      "min-h-control-sm",
      "max-w-content",
      "text-sm",
      "data-[state=open]:bg-surface",
      "aria-[current=page]:text-ink",
      "peer-checked:[&>svg]:opacity-100",
    ]) {
      expect(findWidthVariant(`className="flex ${cls}"`), cls).toHaveLength(0);
    }
    // Ключи объекта и обычный код — не варианты.
    expect(findWidthVariant('const SIZES = { md: "min-h-control", sm: "min-h-control-sm" };')).toHaveLength(0);
    expect(findWidthVariant("function f(width: number) { return width; }")).toHaveLength(0);
    expect(findWidthVariant('window.matchMedia("(prefers-reduced-motion: reduce)")')).toHaveLength(0);
    expect(findWidthVariant("const s = `@media (prefers-color-scheme: dark)`;")).toHaveLength(0);
    expect(findWidthVariant("// md:grid-cols-2 в комментарии")).toHaveLength(0);
  });
  it("в .ts и .tsx из kit и (app) нет sm:, md:, lg:, xl:, max-*: и @media по ширине", () => {
    expectClean(
      "Правило 9: версии различают варианты desktop: и mobile: (tokens.css), а не ширина окна.",
      scan(KIT_AND_APP, findWidthVariant),
    );
  });
});

describe("правило 10: button-styles импортируют только файлы kit", () => {
  it("самопроверка", () => {
    expect(findKitInternalImport('import { lookClasses } from "@/kit/button-styles";')).toHaveLength(1);
    expect(findKitInternalImport('import { x } from "../../kit/button-styles";')).toHaveLength(1);
    expect(findKitInternalImport('import { x } from "../src/kit/button-styles";')).toHaveLength(1);
    expect(findKitInternalImport('const m = await import("@/kit/button-styles");')).toHaveLength(1);
    expect(findKitInternalImport('import { Button, buttonClasses } from "@/kit";')).toHaveLength(0);
    expect(findKitInternalImport('import { ButtonLink } from "@/kit/Button";')).toHaveLength(0);
    expect(findKitInternalImport('import { lookClasses } from "./button-styles";')).toHaveLength(0);
    expect(findKitInternalImport("// from \"@/kit/button-styles\"")).toHaveLength(0);
  });
  it("вне src/kit нет импорта @/kit/button-styles", () => {
    expectClean("Правило 10: кнопки — из @/kit, внутренний button-styles — только для kit.", scan(OUTSIDE_KIT, findKitInternalImport));
  });
});

describe("правило 11: вне src/kit kit импортируется только как @/kit", () => {
  it("самопроверка", () => {
    expect(findKitDeepImport('import { ButtonLink } from "@/kit/Button";')).toHaveLength(1);
    expect(findKitDeepImport('import { cn } from "@/kit/cn";')).toHaveLength(1);
    expect(findKitDeepImport('import { cn } from "../../kit/cn";')).toHaveLength(1);
    expect(findKitDeepImport('const m = await import("@/kit/Sheet");')).toHaveLength(1);
    expect(findKitDeepImport('import { lookClasses } from "@/kit/button-styles";')).toHaveLength(1);
    expect(findKitDeepImport('import { html } from "@/kit/test-utils";')).toHaveLength(1);
    expect(findKitDeepImport('import { html } from "@/kit/test-utils";', true)).toHaveLength(0);
    expect(findKitDeepImport('import { Button, cn } from "@/kit";')).toHaveLength(0);
    expect(findKitDeepImport('import { getTheme } from "@/kit/theme";')).toHaveLength(0);
    expect(findKitDeepImport('import { fontVariables } from "@/kit/fonts";')).toHaveLength(0);
    expect(findKitDeepImport('import { TOKENS } from "@/kit/tokens";')).toHaveLength(0);
    expect(findKitDeepImport('vi.mock("@/kit/theme", () => ({}));', true)).toHaveLength(0);
    expect(findKitDeepImport('import { x } from "./kitchen/a";')).toHaveLength(0);
    expect(findKitDeepImport('import { x } from "@/modules/toolkit/a";')).toHaveLength(0);
    expect(findKitDeepImport('// import { cn } from "@/kit/cn"')).toHaveLength(0);
  });
  it("вне src/kit (с тестами) нет @/kit/<модуль>, кроме theme, fonts, tokens и test-utils в тестах", () => {
    const violations: string[] = [];
    for (const f of OUTSIDE_KIT_WITH_TESTS) {
      for (const h of findKitDeepImport(f.text, /\.test\.tsx?$/.test(f.rel))) violations.push(`${f.rel}:${h.line}  ${h.text}`);
    }
    expectClean("Правило 11: kit — только из @/kit.", violations);
  });
});

describe("правило 8: в ru.app нет слов «демо», «комиссия», «эскроу»", () => {
  it("самопроверка", () => {
    expect(findDemoWord({ a: "Комиссия 4%" })).toHaveLength(1);
    expect(findDemoWord({ a: "Без комиссии" })).toHaveLength(1);
    expect(findDemoWord({ a: "Эскроу-счёт" })).toHaveLength(1);
    expect(findDemoWord({ a: "Деньги в банке под защитой" })).toHaveLength(0);
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
