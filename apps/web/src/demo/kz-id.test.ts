import { describe, expect, it } from "vitest";
import { parseKzIban } from "@/modules/identity";
import { kzCheckDigit, testBin, testIban, testIin } from "./kz-id";

describe("контрольная цифра ИИН/БИН", () => {
  it("считает первый проход с весами 1…11", () => {
    // 9·1 + 0 + 0 + 1·4 + 0 + 1·6 + 3·7 + 0 + 0 + 0 + 1·11 = 51; 51 mod 11 = 7
    expect(kzCheckDigit("90010130001")).toBe(7);
  });

  it("при остатке 10 считает второй проход с весами 3…11, 1, 2", () => {
    // Первый проход: 1·1 + 1·11 = 12 → 1; подбираем основу с остатком 10: 10·1 = 10.
    // «00000000010»: 1·10 = 10 → второй проход: 1·1 = 1.
    expect(kzCheckDigit("00000000010")).toBe(1);
  });

  it("собирает 12-значные тестовые номера с нулевой порядковой частью", () => {
    expect(testIin("900101", 3, 1)).toBe("900101300017");
    expect(testBin("1806", 1)).toMatch(/^18064000001\d$/);
  });
});

describe("тестовый IBAN выплат", () => {
  it("верный KZ IBAN (mod-97) с явной пометкой DEMO; разные номера — разные счета", () => {
    for (const n of [1, 7, 42]) {
      const iban = testIban(n);
      expect(iban).toMatch(/^KZ\d{2}000DEMO\d{9}$/);
      expect(parseKzIban(iban)).toEqual({ ok: true, iban });
    }
    expect(testIban(1)).not.toBe(testIban(2));
  });
});
