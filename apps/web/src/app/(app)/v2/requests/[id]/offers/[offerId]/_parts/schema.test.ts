import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { proposePriceSchema } from "@/modules/requests/client";
import { amountKzt, MAX_PRICE_KZT, proposeSchema } from "./schema";

const t = ru.app.offer.errors;

const errorOf = (raw: string) => {
  const parsed = amountKzt.safeParse(raw);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("цена своего предложения: поле → целые тенге", () => {
  it.each([
    ["450000", 450_000],
    ["1 200 000", 1_200_000],
    ["1 200 000", 1_200_000],
    ["1 200", 1_200],
    [" 980 000 ", 980_000],
    ["1", 1],
    [String(MAX_PRICE_KZT), MAX_PRICE_KZT],
  ])("%j → %d", (raw, kzt) => {
    expect(amountKzt.parse(raw)).toBe(kzt);
  });

  it.each(["", "   ", "0", "-5", "12,5", "12.5", "1e6", "сто", "500000₸"])("%j — ошибка у поля «целое число больше нуля»", (raw) => {
    expect(errorOf(raw)).toBe(t.amount);
  });

  it("больше потолка — своя ошибка", () => {
    expect(errorOf(String(MAX_PRICE_KZT + 1))).toBe(t.amountMax);
    expect(errorOf("9".repeat(30))).toBe(t.amountMax);
  });

  it("границы совпадают со схемой модуля (proposePriceSchema)", () => {
    for (const kzt of [0, 1, 2, MAX_PRICE_KZT - 1, MAX_PRICE_KZT, MAX_PRICE_KZT + 1]) {
      const ours = amountKzt.safeParse(String(kzt)).success;
      const theirs = proposePriceSchema.safeParse({ offerId: "o", amountKzt: kzt }).success;
      expect([kzt, ours]).toEqual([kzt, theirs]);
    }
  });

  it("форма: лишние поля не принимаются, ошибка — у поля amount", () => {
    expect(proposeSchema.safeParse({ offerId: "o", amount: "1", extra: "x" }).success).toBe(false);
    const parsed = proposeSchema.safeParse({ offerId: "o", amount: "0" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["amount"]);
  });
});
