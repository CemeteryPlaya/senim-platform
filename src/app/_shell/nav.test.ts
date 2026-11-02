import { describe, expect, it } from "vitest";
import { currentItem, navFor, splitNav, type NavItem } from "./nav";

const tabs = (...args: Parameters<typeof navFor>) => navFor(...args).tabs.map((item) => item.href);
const more = (...args: Parameters<typeof navFor>) => navFor(...args).more.map((item) => item.href);

const CLIENT = { role: "CLIENT", executor: null } as const;
const EXECUTOR = { role: "EXECUTOR", executor: { status: "APPROVED" } } as const;

describe("вкладки по роли (макеты 7–19)", () => {
  it("гость: главная, каталог, вдохновение; «Войти» — в шапке", () => {
    expect(tabs(null, false)).toEqual(["/", "/catalog", "/inspiration"]);
    expect(more(null, false)).toEqual([]);
  });

  it("гость в демо-режиме может выбрать демо-персону (в «Ещё»)", () => {
    expect(more(null, true)).toEqual(["/bank-demo", "/demo"]);
  });

  it("заказчик: Главная / Мои заявки / Вдохновение / Профиль; сделки и каталог — в профиле и «Ещё»", () => {
    expect(tabs(CLIENT, false)).toEqual(["/", "/requests", "/inspiration", "/profile"]);
    expect(more(CLIENT, false)).toEqual(["/deals", "/catalog", "/notifications"]);
  });

  it("исполнитель: Главная / Заявки / Заказы / Финансы / Профиль", () => {
    expect(tabs(EXECUTOR, false)).toEqual(["/", "/executor/requests", "/deals", "/deals?view=finance", "/profile"]);
    expect(more(EXECUTOR, false)).toEqual(["/executor/measurements", "/executor/profile", "/executor/portfolio", "/notifications"]);
  });

  it("исполнитель на проверке: анкета, портфолио и профиль", () => {
    expect(tabs({ role: "EXECUTOR", executor: { status: "PENDING" } }, false)).toEqual(["/executor/profile", "/executor/portfolio", "/profile"]);
  });

  it("оператор и замерщик — прежние меню и профиль; показ банку и демо — только в демо-режиме", () => {
    expect(tabs({ role: "OPERATOR", executor: null }, false)).toEqual(["/operator", "/deals", "/profile"]);
    expect(more({ role: "OPERATOR", executor: null }, false)).toEqual([]);
    expect(more({ role: "OPERATOR", executor: null }, true)).toEqual(["/bank-demo", "/demo"]);
    expect(tabs({ role: "MEASURER", executor: null }, false)).toEqual(["/measurer", "/profile"]);
    expect(more(CLIENT, true)).toContain("/bank-demo");
  });

  it("у каждого пункта есть подпись и иконка, подписи в одной роли не повторяются", () => {
    for (const user of [null, CLIENT, EXECUTOR] as const) {
      const { tabs: t, more: m } = navFor(user, true);
      const all = [...t, ...m];
      for (const item of all) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.icon.length).toBeGreaterThan(0);
      }
      expect(new Set(all.map((i) => i.label)).size).toBe(all.length);
    }
  });
});

describe("currentItem: какая вкладка активна (aria-current)", () => {
  const { tabs: t, more: m } = navFor(EXECUTOR, false);
  const all: NavItem[] = [...t, ...m];
  const active = (path: string, query = "") => currentItem(all, path, new URLSearchParams(query))?.href;

  it("главная — только на самой главной, а не на любой странице", () => {
    expect(active("/")).toBe("/");
    expect(active("/catalog")).toBeUndefined();
  });

  it("«Заказы» и «Финансы» ведут на один список: различаются параметром адреса", () => {
    expect(active("/deals")).toBe("/deals");
    expect(active("/deals", "view=finance")).toBe("/deals?view=finance");
  });

  it("вложенная страница подсвечивает свой раздел", () => {
    expect(active("/deals/abc")).toBe("/deals");
    expect(active("/executor/requests/42")).toBe("/executor/requests");
  });

  it("из двух подходящих разделов выбирается более точный", () => {
    expect(active("/executor/profile")).toBe("/executor/profile");
    expect(active("/profile")).toBe("/profile");
  });
});

describe("splitNav: что видно сразу, что — в «Ещё»", () => {
  const items = navFor(EXECUTOR, true).tabs;
  const href = (list: readonly { href: string }[]) => list.map((i) => i.href);

  it("помещается — «Ещё» нет", () => {
    const { shown, more: rest } = splitNav(items, 5);
    expect(href(shown)).toEqual(href(items));
    expect(rest).toEqual([]);
  });

  it("не помещается — последняя ячейка уходит под «Ещё», порядок сохраняется", () => {
    const { shown, more: rest } = splitNav(items, 3);
    expect(href(shown)).toEqual(href(items.slice(0, 2)));
    expect(href(rest)).toEqual(href(items.slice(2)));
  });

  it("«Ещё» нужен ради другого содержимого — под него освобождается ячейка", () => {
    const { shown, more: rest } = splitNav(items.slice(0, 4), 4, true);
    expect(shown).toHaveLength(3);
    expect(href(rest)).toEqual([items[3].href]);
  });

  it("пунктов мало, а «Ещё» нужен — все пункты видны", () => {
    const { shown, more: rest } = splitNav(items.slice(0, 2), 4, true);
    expect(shown).toHaveLength(2);
    expect(rest).toEqual([]);
  });
});
