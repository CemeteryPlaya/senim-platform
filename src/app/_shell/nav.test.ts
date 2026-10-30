import { describe, expect, it } from "vitest";
import { navFor } from "./nav";

const hrefs = (...args: Parameters<typeof navFor>) => navFor(...args).map((item) => item.href);

describe("навигация по роли", () => {
  it("гость видит каталог (кнопка «Войти» — отдельно, в шапке)", () => {
    expect(hrefs(null, false)).toEqual(["/catalog"]);
  });

  it("гость в демо-режиме может выбрать демо-персону", () => {
    expect(hrefs(null, true)).toEqual(["/catalog", "/demo"]);
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
    expect(hrefs({ role: "OPERATOR", executor: null }, false)).toEqual(["/operator"]);
    expect(hrefs({ role: "OPERATOR", executor: null }, true)).toEqual(["/operator", "/bank-demo", "/demo"]);
  });

  it("у каждого пункта есть подпись и иконка", () => {
    for (const item of navFor({ role: "CLIENT", executor: null }, true)) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
});
