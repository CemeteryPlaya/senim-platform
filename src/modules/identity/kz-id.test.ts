import { describe, expect, it } from "vitest";
import { kzCheckDigit, testBin, testIin } from "@/demo/kz-id";
import { binIinKindFor, isValidBin, isValidIin } from "./kz-id";

describe("ИИН", () => {
  it("принимает номер с верной контрольной цифрой", () => {
    expect(isValidIin(testIin("940512", 4, 11))).toBe(true);
    expect(isValidIin(testIin("880217", 3, 12))).toBe(true);
  });

  it("отклоняет неверную контрольную цифру", () => {
    const iin = testIin("940512", 4, 11);
    const broken = iin.slice(0, 11) + String((Number(iin[11]) + 1) % 10);
    expect(isValidIin(broken)).toBe(false);
  });

  it.each([
    ["94051241001", "11 цифр"],
    ["9405124100111", "13 цифр"],
    ["94O512410011", "буква"],
  ])("отклоняет %s (%s)", (value) => {
    expect(isValidIin(value)).toBe(false);
  });

  it("отклоняет несуществующую дату рождения и неверную цифру века", () => {
    expect(isValidIin(withValidCheck("941312400011"))).toBe(false); // месяц 13
    expect(isValidIin(withValidCheck("940532400011"))).toBe(false); // день 32
    expect(isValidIin(withValidCheck("940512000021"))).toBe(false); // век/пол 0
    expect(isValidIin(withValidCheck("940512700011"))).toBe(false); // век/пол 7
  });

  it("БИН не проходит как ИИН", () => {
    expect(isValidIin(testBin("2101", 16))).toBe(false);
  });
});

describe("БИН", () => {
  it("принимает номер с верной контрольной цифрой", () => {
    expect(isValidBin(testBin("2101", 16))).toBe(true);
    expect(isValidBin("210140000016")).toBe(true);
  });

  it("отклоняет неверную контрольную цифру", () => {
    expect(isValidBin("210140000017")).toBe(false);
  });

  it("ИИН не проходит как БИН (5-я цифра — тип организации 4–6)", () => {
    expect(isValidBin(testIin("940512", 4, 11))).toBe(false);
  });
});

describe("binIinKindFor", () => {
  it("самозанятый и ИП — ИИН, ТОО — БИН", () => {
    expect(binIinKindFor("SELF_EMPLOYED")).toBe("IIN");
    expect(binIinKindFor("IP")).toBe("IIN");
    expect(binIinKindFor("TOO")).toBe("BIN");
  });
});

/** Подставляет верную контрольную цифру, чтобы проверять только структуру номера. */
function withValidCheck(twelve: string): string {
  const first11 = twelve.slice(0, 11);
  const check = kzCheckDigit(first11);
  if (check === null) throw new Error(`для ${first11} нет контрольной цифры — смените пример`);
  return first11 + check;
}
