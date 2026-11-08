import { describe, expect, it } from "vitest";
import { ru } from "./ru";

/**
 * Решение владельца 2.1.4 (ТЗ п. 5): в текстах покупателя и мастера нет слов «эскроу» и «комиссия» (любая
 * форма, любой регистр). Вместо «эскроу» — «деньги в банке под защитой», вместо «комиссии» — «Защита сделки (2%)»
 * и «Гарантия оплаты и клиента (4%)».
 *
 * Проверяются все зоны `ru`, кроме перечисленных ниже: новая зона попадает под проверку сама.
 * Исключения (там «эскроу» допустимо по тому же решению):
 * - `operator` — панель оператора: оператор подтверждает операции счёта эскроу по банковским документам;
 * - `bankDemo` — страница показа банку: её читает банк, модель счёта называется своим именем;
 * - `documents.pdf` — текст оферты, договоров и актов внутри PDF (юридический документ). Подписи экранов
 *   подписания из `documents` покупатель и мастер видят — они проверяются.
 */
const EXCLUDED_ZONES = new Set<string>(["operator", "bankDemo"]);
const EXCLUDED_PATHS = ["documents.pdf"];

const FORBIDDEN = /эскроу|комисси/iu;

/** Все строки дерева текстов с путём. Функция-шаблон проверяется по исходнику: в нём весь текст шаблона. */
function textsOf(value: unknown, path: string): { path: string; text: string }[] {
  if (EXCLUDED_PATHS.some((p) => path === p || path.startsWith(`${p}.`))) return [];
  if (typeof value === "string") return [{ path, text: value }];
  if (typeof value === "function") return [{ path, text: String(value) }];
  if (Array.isArray(value)) return value.flatMap((v, i) => textsOf(v, `${path}.${i}`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => textsOf(v, `${path}.${k}`));
  return [];
}

const violations = (zone: string) => textsOf(ru[zone as keyof typeof ru], zone).filter((t) => FORBIDDEN.test(t.text));

describe("запрещённые слова в текстах покупателя и мастера (решение 2.1.4)", () => {
  it("находит слово в строке, в шаблоне-функции и в массиве, в любом регистре", () => {
    const sample = { a: "Счёт ЭСКРОУ", b: (n: number) => `Комиссия ${n}`, c: ["ок", "без комиссий"], d: "Защита сделки (2%)" };
    expect(
      textsOf(sample, "x")
        .filter((t) => FORBIDDEN.test(t.text))
        .map((t) => t.path),
    ).toEqual(["x.a", "x.b", "x.c.1"]);
  });

  it("исключённый путь не проверяется, соседние — проверяются", () => {
    expect(textsOf({ pdf: { body: "эскроу" }, panel: "эскроу" }, "documents").map((t) => t.path)).toEqual(["documents.panel"]);
  });

  it.each(Object.keys(ru).filter((zone) => !EXCLUDED_ZONES.has(zone)))("ru.%s — без «эскроу» и «комисси»", (zone) => {
    expect(violations(zone)).toEqual([]);
  });
});
