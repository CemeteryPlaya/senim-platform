import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/ui";
import { groupOf, REQUEST_GROUP, termsText } from "./labels";

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

describe("разделы «Моих заявок»", () => {
  it("каждый статус попадает ровно в один раздел", () => {
    expect(REQUEST_GROUP.DRAFT).toBe("draft");
    expect(REQUEST_GROUP.OPEN).toBe("waiting");
    expect(REQUEST_GROUP.PLATFORM_MEASURING).toBe("waiting");
    expect(REQUEST_GROUP.OFFER_CHOSEN).toBe("chosen");
    expect(REQUEST_GROUP.MEASURING).toBe("chosen");
    expect(REQUEST_GROUP.CONTRACTING).toBe("contract");
    expect(REQUEST_GROUP.CLOSED).toBe("contract");
    expect(REQUEST_GROUP.CANCELLED).toBe("cancelled");
  });

  it("раздел из адреса: неизвестный — «Все»", () => {
    expect(groupOf("waiting")).toBe("waiting");
    expect(groupOf("nonsense")).toBe("all");
    expect(groupOf(undefined)).toBe("all");
  });
});
