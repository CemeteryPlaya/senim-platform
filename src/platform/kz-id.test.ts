import { describe, expect, it } from "vitest";
import { kzCheckDigit } from "./kz-id";

describe("kzCheckDigit: контрольная цифра ИИН/БИН", () => {
  it("первая сумма весов по модулю 11 и есть контрольная цифра", () => {
    expect(kzCheckDigit("10000000000")).toBe(1);
    expect(kzCheckDigit("01000000000")).toBe(2);
    expect(kzCheckDigit("00000000100")).toBe(9);
    expect(kzCheckDigit("00000000000")).toBe(0);
  });

  it("первая сумма дала 10 — считается вторая с другими весами", () => {
    expect(kzCheckDigit("00000000010")).toBe(1);
  });

  it("обе суммы дали 10 — номер с такой основой не выдаётся", () => {
    expect(kzCheckDigit("00000000281")).toBeNull();
  });

  it("основа — ровно 11 цифр", () => {
    for (const bad of ["1234567890", "123456789012", "1234567890a", " 12345678901", "12345678901 "]) {
      expect(() => kzCheckDigit(bad)).toThrow("Нужно ровно 11 цифр");
    }
  });
});
