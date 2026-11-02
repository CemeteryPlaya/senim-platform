import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { ibanField, parseKzIban } from "./iban";

/** Примеры проверены независимым расчётом mod-97 (ISO 13616); первый — пример KZ IBAN из реестра SWIFT. */
const VALID = ["KZ86125KZT5004100100", "KZ75125KZT2069100100", "KZ18722S000012345678", "KZ14998CTB0000123456", "KZ86601A861000000001"];

describe("KZ IBAN: KZ + 2 контрольные цифры + 16 символов, mod-97 = 1", () => {
  it.each(VALID)("%s — верный", (iban) => {
    expect(parseKzIban(iban)).toEqual({ ok: true, iban });
  });

  it("пробелы, строчные буквы и группы по 4 — как в банковском приложении — нормализуются", () => {
    expect(parseKzIban(" kz86 125k zt50 0410 0100 ")).toEqual({ ok: true, iban: "KZ86125KZT5004100100" });
    expect(parseKzIban("KZ86 125K ZT50 0410 0100")).toEqual({ ok: true, iban: "KZ86125KZT5004100100" });
  });

  it.each([
    ["одна цифра изменена", "KZ86125KZT5004100101"],
    ["переставлены соседние цифры", "KZ86125KZT5004101000"],
    ["неверные контрольные цифры", "KZ87125KZT5004100100"],
  ])("%s — ошибка контрольной суммы", (_, iban) => {
    expect(parseKzIban(iban)).toEqual({ ok: false, reason: "checksum" });
  });

  it.each([
    ["пусто", ""],
    ["короче 20", "KZ86125KZT500410010"],
    ["длиннее 20", "KZ86125KZT50041001000"],
    ["чужая страна", "DE89370400440532013000"],
    ["буквы вместо контрольных цифр", "KZAB125KZT5004100100"],
    ["недопустимый символ", "KZ86125KZT50041001-0"],
    ["кириллица", "КZ86125KZT5004100100"],
  ])("%s — ошибка формата", (_, iban) => {
    expect(parseKzIban(iban)).toEqual({ ok: false, reason: "format" });
  });
});

describe("поле IBAN в форме (zod)", () => {
  it("верный — нормализованная строка; ошибки — понятные сообщения", () => {
    expect(ibanField.parse("kz86 125k zt50 0410 0100")).toBe("KZ86125KZT5004100100");
    expect(ibanField.safeParse("KZ86125KZT5004100101").error?.issues[0]?.message).toBe(ru.identity.payout.errors.checksum);
    expect(ibanField.safeParse("KZ86").error?.issues[0]?.message).toBe(ru.identity.payout.errors.format);
  });
});
