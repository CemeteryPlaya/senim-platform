import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";

const t = ru.app.guest.executor;

describe("склонения профиля мастера", () => {
  it.each([
    [1, "1 год"],
    [2, "2 года"],
    [4, "4 года"],
    [5, "5 лет"],
    [11, "11 лет"],
    [12, "12 лет"],
    [14, "14 лет"],
    [21, "21 год"],
    [22, "22 года"],
    [101, "101 год"],
    [111, "111 лет"],
  ])("стаж %i", (n, years) => {
    expect(t.years(n)).toBe(years);
  });
});

describe("общий список мастеров", () => {
  const l = ru.app.guest.executors;
  it("заголовок «Мастера», «Сделок», «Успешных»; без оконченных сделок — без доли", () => {
    expect(l.title).toBe("Мастера");
    expect(l.deals).toBe("Сделок");
    expect(l.success).toBe("Успешных");
    expect(l.statsLine(12, 92)).toBe("Сделок: 12 · Успешных: 92%");
    expect(l.statsLine(3, null)).toBe("Сделок: 3");
    expect(l.beyond.body(1)).toBe("В списке 1 страница");
    expect(l.beyond.body(5)).toBe("В списке 5 страниц");
  });

  it("нет «комисси», «эскроу», «демо», «отклик» (и «платформ» — общий сторож ниже)", () => {
    expect(JSON.stringify(l) + l.statsLine(1, 1) + l.forRequest(7)).not.toMatch(/комисси|эскроу|демо|отклик|платформ/i);
  });
});

describe("шапка профиля мастера", () => {
  it("«Сделок», «Успешных N%»; нет оконченных — «Пока нет завершённых сделок»", () => {
    expect(t.stats.deals).toBe("Сделок");
    expect(t.stats.success).toBe("Успешных");
    expect(t.stats.percent(93)).toBe("93%");
    expect(t.stats.successNone).toBe("Пока нет завершённых сделок");
  });

  it("подпись отзыва — как выбрал покупатель; итог сделки — «Завершена» или «Не состоялась»", () => {
    expect(t.reviewSignature("Айгерим")).toBe("— Айгерим");
    expect(t.reviewSignature("А.")).toBe("— А.");
    expect(t.outcome).toEqual({ success: "Завершена", failed: "Не состоялась" });
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
