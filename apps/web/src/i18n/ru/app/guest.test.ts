import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";

const t = ru.app.guest.executor;

describe("склонения профиля мастера", () => {
  it.each([
    [1, "1 сделка", "1 год"],
    [2, "2 сделки", "2 года"],
    [4, "4 сделки", "4 года"],
    [5, "5 сделок", "5 лет"],
    [11, "11 сделок", "11 лет"],
    [12, "12 сделок", "12 лет"],
    [14, "14 сделок", "14 лет"],
    [21, "21 сделка", "21 год"],
    [22, "22 сделки", "22 года"],
    [101, "101 сделка", "101 год"],
    [111, "111 сделок", "111 лет"],
  ])("%i", (n, deals, years) => {
    expect(t.facts.deals(n).value).toBe(deals);
    expect(t.facts.years(n).value).toBe(years);
  });
});

describe("строка-сводка профиля мастера", () => {
  it("сделок нет — «Пока без сделок» без выделяемого значения; «на платформе» нигде нет", () => {
    expect(t.facts.deals(0)).toEqual({ value: "Пока без сделок", plain: true });
    expect(t.facts.years(0).value).toBe("0 лет");
    expect(t.facts.deals(3)).toEqual({ value: "3 сделки", after: "в сервисе" });
  });

  it("в текстах гостевых экранов и входа нет слова «платформа» (кроме юридических текстов, которых здесь нет)", () => {
    const all = JSON.stringify(ru.app.guest) + JSON.stringify(ru.app.login) + JSON.stringify(ru.app.onboarding) + JSON.stringify(ru.app.shell);
    expect(all).not.toMatch(/платформ/i);
    expect(ru.app.guest.about.price.buyerLabel).toBe("Если вы покупатель");
    expect(ru.app.guest.about.price.masterLabel).toBe("Если вы мастер");
  });
});

describe("склонения каталога", () => {
  const c = ru.app.guest.catalog;
  it.each([
    [1, "Найдена 1 работа", "1 отзыв", "В каталоге 1 страница"],
    [2, "Найдено 2 работы", "2 отзыва", "В каталоге 2 страницы"],
    [5, "Найдено 5 работ", "5 отзывов", "В каталоге 5 страниц"],
    [11, "Найдено 11 работ", "11 отзывов", "В каталоге 11 страниц"],
    [21, "Найдена 21 работа", "21 отзыв", "В каталоге 21 страница"],
    [24, "Найдено 24 работы", "24 отзыва", "В каталоге 24 страницы"],
  ])("%i", (n, found, reviews, pages) => {
    expect(c.found(n)).toBe(found);
    expect(c.reviews(n)).toBe(reviews);
    expect(c.pagesInCatalogue(n)).toBe(pages);
  });
});
