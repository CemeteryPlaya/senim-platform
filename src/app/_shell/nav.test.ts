import { describe, expect, it } from "vitest";
import { navFor, splitNav } from "./nav";

const hrefs = (...args: Parameters<typeof navFor>) => navFor(...args).map((item) => item.href);

describe("навигация по роли", () => {
  it("гость видит каталог (кнопка «Войти» — отдельно, в шапке)", () => {
    expect(hrefs(null, false)).toEqual(["/catalog"]);
  });

  it("гость в демо-режиме может выбрать демо-персону", () => {
    expect(hrefs(null, true)).toEqual(["/catalog", "/bank-demo", "/demo"]);
  });

  it("заказчик: заявки, каталог, сделки, уведомления", () => {
    expect(hrefs({ role: "CLIENT", executor: null }, false)).toEqual(["/requests", "/catalog", "/deals", "/notifications"]);
  });

  it("подтверждённый исполнитель: заявки, замеры, сделки, уведомления, профиль, портфолио", () => {
    expect(hrefs({ role: "EXECUTOR", executor: { status: "APPROVED" } }, false)).toEqual([
      "/executor/requests",
      "/executor/measurements",
      "/deals",
      "/notifications",
      "/executor/profile",
      "/executor/portfolio",
    ]);
  });

  it("исполнитель на проверке видит только профиль, портфолио и уведомления", () => {
    expect(hrefs({ role: "EXECUTOR", executor: { status: "PENDING" } }, false)).toEqual([
      "/executor/profile",
      "/executor/portfolio",
      "/notifications",
    ]);
  });

  it("оператор: панель оператора; показ банку и демо-персоны — только в демо-режиме", () => {
    expect(hrefs({ role: "OPERATOR", executor: null }, false)).toEqual(["/operator", "/deals"]);
    expect(hrefs({ role: "OPERATOR", executor: null }, true)).toEqual(["/operator", "/deals", "/bank-demo", "/demo"]);
    expect(hrefs({ role: "CLIENT", executor: null }, true)).toContain("/bank-demo");
  });

  it("у каждого пункта есть подпись и иконка", () => {
    for (const item of navFor({ role: "CLIENT", executor: null }, true)) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("splitNav: что видно сразу, что — в «Ещё»", () => {
  const items = navFor({ role: "EXECUTOR", executor: { status: "APPROVED" } }, true);
  const href = (list: readonly { href: string }[]) => list.map((i) => i.href);

  it("помещается — «Ещё» нет", () => {
    const { shown, more } = splitNav(items.slice(0, 4), 4);
    expect(href(shown)).toEqual(href(items.slice(0, 4)));
    expect(more).toEqual([]);
  });

  it("не помещается — последняя ячейка уходит под «Ещё», порядок сохраняется", () => {
    const { shown, more } = splitNav(items, 4);
    expect(href(shown)).toEqual(href(items.slice(0, 3)));
    expect(href(more)).toEqual(href(items.slice(3)));
  });

  it("«Ещё» нужен ради другого содержимого (например, «Выйти») — под него освобождается ячейка", () => {
    const { shown, more } = splitNav(items.slice(0, 4), 4, true);
    expect(shown).toHaveLength(3);
    expect(href(more)).toEqual([items[3].href]);
  });

  it("пунктов мало, а «Ещё» нужен — все пункты видны", () => {
    const { shown, more } = splitNav(items.slice(0, 2), 4, true);
    expect(shown).toHaveLength(2);
    expect(more).toEqual([]);
  });
});
