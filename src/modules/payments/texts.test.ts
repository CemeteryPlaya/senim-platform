import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";

/** Тексты сделки и денег видят покупатель и мастер: «комиссия» и «эскроу» запрещены (ТЗ п. 5, решение 2.1.4). */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const out = (value as (...a: unknown[]) => unknown)(1, "1 000 ₸", "1 000 ₸");
    return strings(out);
  }
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("тексты сделки и денег", () => {
  it.each(["deal", "payments"] as const)("ru.%s без «эскроу» и «комисси»", (zone) => {
    const bad = strings(ru[zone]).filter((s) => /эскроу|комисси/i.test(s));
    expect(bad).toEqual([]);
  });
});
