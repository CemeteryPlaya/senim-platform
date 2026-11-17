import { describe, expect, it } from "vitest";
import { givenNameOf, publicSignatureOf } from "./full-name";

describe("имя для публичной подписи", () => {
  it("«Фамилия Имя Отчество» — имя второе слово; одно слово — оно же; пусто — пустая строка", () => {
    expect(givenNameOf("Сапарова Айгерим Маратовна")).toBe("Айгерим");
    expect(givenNameOf("  Сапарова   Айгерим ")).toBe("Айгерим");
    expect(givenNameOf("Айгерим")).toBe("Айгерим");
    expect(givenNameOf("")).toBe("");
    expect(givenNameOf(null)).toBe("");
  });

  it("слово ЗАГЛАВНЫМИ или строчными — как имя; дефисные части — каждая отдельно", () => {
    expect(givenNameOf("САПАРОВА АЙГЕРИМ")).toBe("Айгерим");
    expect(givenNameOf("сапарова әсел")).toBe("Әсел");
    expect(givenNameOf("Ли АННА-МАРИЯ")).toBe("Анна-Мария");
  });

  it("подпись: NAME — имя, INITIAL — первая буква и точка; без имени — пусто", () => {
    expect(publicSignatureOf("Сапарова Айгерим Маратовна", "NAME")).toBe("Айгерим");
    expect(publicSignatureOf("Сапарова Айгерим Маратовна", "INITIAL")).toBe("А.");
    expect(publicSignatureOf("сапарова әсел", "INITIAL")).toBe("Ә.");
    expect(publicSignatureOf(null, "NAME")).toBe("");
    expect(publicSignatureOf("", "INITIAL")).toBe("");
  });
});
