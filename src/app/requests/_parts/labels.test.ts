import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/ui";
import { termsText } from "./labels";

describe("termsText: условия замера одной строкой", () => {
  it("бесплатно и включён в стоимость — готовые тексты", () => {
    expect(termsText("FREE", null)).toBe(ru.requests.terms.FREE);
    expect(termsText("INCLUDED", 5_000)).toBe(ru.requests.terms.INCLUDED);
  });

  it("плата за выезд — с суммой; без суммы — 0 ₸", () => {
    expect(termsText("FEE_IF_NO_DEAL", 10_000)).toBe(ru.requests.terms.FEE_IF_NO_DEAL(formatMoney(10_000)));
    expect(termsText("FEE_IF_NO_DEAL", null)).toBe(ru.requests.terms.FEE_IF_NO_DEAL(formatMoney(0)));
  });
});
