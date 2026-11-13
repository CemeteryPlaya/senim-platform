import { describe, expect, it } from "vitest";
import { digitsOnly } from "./digits";

describe("digitsOnly", () => {
  it("убирает пробелы, дефисы и буквы", () => {
    expect(digitsOnly("123 456")).toBe("123456");
    expect(digitsOnly("12-34 a5")).toBe("12345");
    expect(digitsOnly("+7 (700) 123-45-67")).toBe("77001234567");
  });
  it("пустая и без цифр — пустая строка", () => {
    expect(digitsOnly("")).toBe("");
    expect(digitsOnly("abc")).toBe("");
  });
  it("не считает цифрами арабо-индийские", () => {
    expect(digitsOnly("٣٤5")).toBe("5");
  });
});
