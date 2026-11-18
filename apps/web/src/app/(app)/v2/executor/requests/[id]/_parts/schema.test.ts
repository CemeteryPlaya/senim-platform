import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { proposePriceSchema, sendOfferSchema } from "@/modules/requests/client";
import { declineSchema, DAYS, MAX_PRICE_KZT, parsePriceKzt, priceKzt, proposeSchema, sendSchema, WARRANTY } from "./schema";

const t = ru.app.masterOffer.errors;

const errorOf = (raw: string) => {
  const parsed = priceKzt.safeParse(raw);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

const form = (over: Record<string, string> = {}) => ({ requestId: "r", price: "500 000", days: "30", warranty: "12", comment: "", ...over });

describe("цена предложения мастера: поле → целые тенге", () => {
  it.each([
    ["450000", 450_000],
    ["1 200 000", 1_200_000],
    ["1 200 000", 1_200_000],
    [" 980 000 ", 980_000],
    ["1", 1],
    [String(MAX_PRICE_KZT), MAX_PRICE_KZT],
  ])("%j → %d", (raw, kzt) => {
    expect(priceKzt.parse(raw)).toBe(kzt);
    expect(parsePriceKzt(raw)).toBe(kzt);
  });

  it.each(["", "   ", "0", "-5", "12,5", "12.5", "1e6", "сто", "500000₸"])("%j — ошибка у поля «целое число больше нуля», расчёта нет", (raw) => {
    expect(errorOf(raw)).toBe(t.price);
    expect(parsePriceKzt(raw)).toBeNull();
  });

  it("больше потолка — своя ошибка", () => {
    expect(errorOf(String(MAX_PRICE_KZT + 1))).toBe(t.priceMax);
    expect(errorOf("9".repeat(30))).toBe(t.priceMax);
  });

  it("границы цены, срока и гарантии совпадают со схемами модуля (sendOfferSchema, proposePriceSchema)", () => {
    for (const kzt of [0, 1, 2, MAX_PRICE_KZT, MAX_PRICE_KZT + 1]) {
      expect([kzt, sendSchema.safeParse(form({ price: String(kzt) })).success]).toEqual([
        kzt,
        sendOfferSchema.safeParse({ requestId: "r", priceKzt: kzt, durationDays: 30, warrantyMonths: 12, comment: "" }).success,
      ]);
      expect([kzt, proposeSchema.safeParse({ offerId: "o", amount: String(kzt) }).success]).toEqual([
        kzt,
        proposePriceSchema.safeParse({ offerId: "o", amountKzt: kzt }).success,
      ]);
    }
    for (const days of [DAYS.min - 1, DAYS.min, DAYS.max, DAYS.max + 1]) {
      expect([days, sendSchema.safeParse(form({ days: String(days) })).success]).toEqual([
        days,
        sendOfferSchema.safeParse({ requestId: "r", priceKzt: 1, durationDays: days, warrantyMonths: 12, comment: "" }).success,
      ]);
    }
    for (const months of [WARRANTY.min, WARRANTY.max, WARRANTY.max + 1]) {
      expect([months, sendSchema.safeParse(form({ warranty: String(months) })).success]).toEqual([
        months,
        sendOfferSchema.safeParse({ requestId: "r", priceKzt: 1, durationDays: 30, warrantyMonths: months, comment: "" }).success,
      ]);
    }
  });

  it("форма предложения: ошибки — у своих полей; лишние поля (условия замера) не принимаются", () => {
    const parsed = sendSchema.safeParse(form({ price: "0", days: "0", warranty: "-1", comment: "я".repeat(1001) }));
    expect(parsed.success).toBe(false);
    const byField = Object.fromEntries((parsed.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));
    expect(byField).toEqual({ price: t.price, days: t.days, warranty: t.warranty, comment: t.comment });
    expect(sendSchema.safeParse({ ...form(), measurementTerms: "FREE" }).success).toBe(false);
    expect(sendSchema.parse(form({ comment: "  Блюм  " }))).toEqual({ requestId: "r", price: 500_000, days: 30, warranty: 12, comment: "Блюм" });
  });
});

describe("declineSchema: отказ от приглашения", () => {
  const first = (reason: string) => {
    const parsed = declineSchema.safeParse({ requestId: "r", reason });
    return parsed.success ? null : parsed.error.issues[0]?.message;
  };

  it("причина 3..300 знаков после обрезки пробелов; иначе — текст у поля", () => {
    expect(first("")).toBe(t.declineReason);
    expect(first("  ab  ")).toBe(t.declineReason);
    expect(first("abc")).toBeNull();
    expect(first("я".repeat(300))).toBeNull();
    expect(first("я".repeat(301))).toBe(t.declineReason);
    expect(declineSchema.parse({ requestId: "r", reason: "  Занят  " })).toEqual({ requestId: "r", reason: "Занят" });
  });
});
