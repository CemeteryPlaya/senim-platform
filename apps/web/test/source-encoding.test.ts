import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Исходники — только UTF-8. Типичная порча: файл прочитан как Windows-1251 и записан обратно в UTF-8
 * (например, PowerShell 5.1 `Get-Content` без `-Encoding`). Тогда «Классы» превращается в «РљР»Р°СЃСЃС‹»,
 * а тире «—» — в «вЂ”». Тест ищет такие пары во всех текстовых файлах src/ и e2e/.
 *
 * Шаблон собран из кодов символов, чтобы этот файл сам под него не попадал:
 * «Р» (U+0420) + символ U+0450–U+045F — так выглядят байты D0 B0–BF кириллицы в 1251;
 * «вЂ» (U+0432 U+0402) — начало знаков пунктуации E2 80 xx (тире, кавычки, многоточие).
 */
const MOJIBAKE = new RegExp("\\u0420[\\u0450-\\u045f]|\\u0432\\u0402");

const ROOT = path.join(__dirname, "..");
const DIRS = ["src", "e2e"].map((d) => path.join(ROOT, d));
const SKIP = new Set([path.join(ROOT, "src", "generated")]);
const TEXT = /\.(ts|tsx|mts|js|mjs|css|json|md)$/;

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (SKIP.has(full)) return [];
    if (statSync(full).isDirectory()) return textFiles(full);
    return TEXT.test(name) ? [full] : [];
  });
}

describe("кодировка исходников", () => {
  it("шаблон узнаёт текст, прочитанный как 1251, и не трогает обычный русский", () => {
    const utf8 = Buffer.from("Классы — целиком", "utf8");
    const broken = new TextDecoder("windows-1251").decode(utf8);
    expect(MOJIBAKE.test(broken)).toBe(true);
    expect(MOJIBAKE.test("Классы — целиком. Роль, Рынок, Работы, «Рядом»")).toBe(false);
  });

  it("в src/ и e2e/ нет испорченной кириллицы", () => {
    const offenders = DIRS.flatMap(textFiles).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (MOJIBAKE.test(line) ? [`${path.relative(ROOT, file)}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
