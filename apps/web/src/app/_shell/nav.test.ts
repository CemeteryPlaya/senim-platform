import { describe, expect, it } from "vitest";
import { currentItem, groupNav, navFor, splitNav, type NavItem } from "./nav";

const tabs = (...args: Parameters<typeof navFor>) => navFor(...args).tabs.map((item) => item.href);
const more = (...args: Parameters<typeof navFor>) => navFor(...args).more.map((item) => item.href);

const CLIENT = { role: "CLIENT", executor: null } as const;
/** По умолчанию в тестах флаги включены — проверяем полное меню; выключенные — отдельным тестом. */
const ON = { preContractFlows: true, inspiration: true, materialsCalculator: true };
const OFF = { preContractFlows: false, inspiration: false, materialsCalculator: false };
const EXECUTOR = { role: "EXECUTOR", executor: { status: "APPROVED" } } as const;

const MEASURER = { role: "MEASURER", executor: null } as const;
const OPERATOR = { role: "OPERATOR", executor: null } as const;

describe("вкладки по роли («B + A»)", () => {
  it("гость: Главная / Работы / Войти", () => {
    expect(tabs(null, false, ON)).toEqual(["/", "/catalog", "/login"]);
    expect(more(null, false, ON)).toEqual([]);
  });

  it("гость в демо-режиме может выбрать демо-персону (в «Ещё»)", () => {
    expect(more(null, true, ON)).toEqual(["/bank-demo", "/demo"]);
  });

  it("заказчик: Главная / Сделки / Заявка / Чат / Профиль; остальное — в «Ещё»", () => {
    expect(tabs(CLIENT, false, ON)).toEqual(["/", "/deals", "/requests/new", "/chats", "/profile"]);
    expect(more(CLIENT, false, ON)).toEqual(["/requests", "/catalog", "/inspiration", "/notifications"]);
  });

  it("у заказчика ровно одно центральное действие — «Заявка»", () => {
    const primary = navFor(CLIENT, false, ON).tabs.filter((item) => item.primary);
    expect(primary.map((item) => item.href)).toEqual(["/requests/new"]);
    expect(primary[0].label).toBe("Заявка");
    expect(navFor(CLIENT, false, ON).tabs[2]).toBe(primary[0]);
  });

  it("у остальных ролей центрального действия нет", () => {
    for (const user of [null, EXECUTOR, MEASURER, OPERATOR]) {
      const nav = navFor(user, true, ON);
      expect([...nav.tabs, ...nav.more].some((item) => item.primary)).toBe(false);
    }
  });

  it("исполнитель: Заявки / Заказы / Чат / Финансы / Профиль", () => {
    expect(tabs(EXECUTOR, false, ON)).toEqual(["/executor/requests", "/deals", "/chats", "/executor/finance", "/profile"]);
    expect(more(EXECUTOR, false, ON)).toEqual(["/executor/measurements", "/executor/profile", "/executor/portfolio", "/notifications"]);
  });

  it("исполнитель на проверке: анкета, портфолио и профиль", () => {
    expect(tabs({ role: "EXECUTOR", executor: { status: "PENDING" } }, false, ON)).toEqual(["/executor/profile", "/executor/portfolio", "/profile"]);
  });

  it("замерщик: Замеры / Чат / Профиль", () => {
    expect(tabs(MEASURER, false, ON)).toEqual(["/measurer", "/chats", "/profile"]);
    expect(navFor(MEASURER, false, ON).tabs[0].label).toBe("Замеры");
  });

  const OPERATOR_SECTIONS = [
    "/operator/money",
    "/operator/kyc",
    "/operator/consents",
    "/operator/executors",
    "/operator/disputes",
    "/operator/requests",
    "/operator/deals",
    "/operator/income",
    "/operator/report",
    "/operator/audit",
    "/operator/furniture-types",
    "/operator/materials",
    "/operator/settings",
  ];

  it("оператор: вкладок нет, все разделы — в боковом меню; показ банку и демо — только в демо-режиме", () => {
    expect(tabs(OPERATOR, false, ON)).toEqual([]);
    expect(more(OPERATOR, false, ON)).toEqual(["/operator", ...OPERATOR_SECTIONS, "/profile"]);
    expect(more(OPERATOR, true, ON)).toEqual(["/operator", ...OPERATOR_SECTIONS, "/operator/demo", "/profile", "/bank-demo", "/demo"]);
    expect(more(CLIENT, true, ON)).toContain("/bank-demo");
    expect(more(CLIENT, true, ON)).not.toContain("/operator/demo");
  });

  it("оператор: разделы по группам — очереди, сделки и отчёты, справочники; «Оператор» и «Профиль» вне групп", () => {
    const runs = groupNav(navFor(OPERATOR, true, ON).more).map((run) => [run.group ?? null, run.items.map((item) => item.href)]);
    expect(runs).toEqual([
      [null, ["/operator"]],
      ["queues", OPERATOR_SECTIONS.slice(0, 6)],
      ["dealsReports", OPERATOR_SECTIONS.slice(6, 10)],
      ["reference", [...OPERATOR_SECTIONS.slice(10), "/operator/demo"]],
      [null, ["/profile", "/bank-demo", "/demo"]],
    ]);
  });

  it("у каждого пункта есть подпись и иконка, подписи в одной роли не повторяются", () => {
    for (const user of [null, CLIENT, EXECUTOR, MEASURER, OPERATOR] as const) {
      const { tabs: t, more: m } = navFor(user, true, ON);
      const all = [...t, ...m];
      for (const item of all) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.icon.length).toBeGreaterThan(0);
      }
      expect(new Set(all.map((i) => i.label)).size).toBe(all.length);
    }
  });
});

describe("разделы за флагами", () => {
  it("флаги выключены: нет «Вдохновения» у заказчика и «Замеров» мастера", () => {
    expect(tabs(null, false, OFF)).toEqual(["/", "/catalog", "/login"]);
    expect(tabs(CLIENT, false, OFF)).toEqual(["/", "/deals", "/requests/new", "/chats", "/profile"]);
    expect(more(CLIENT, false, OFF)).toEqual(["/requests", "/catalog", "/notifications"]);
    expect(more(EXECUTOR, false, OFF)).toEqual(["/executor/profile", "/executor/portfolio", "/notifications"]);
    expect(more(EXECUTOR, true, OFF)).toEqual(["/executor/profile", "/executor/portfolio", "/notifications", "/bank-demo", "/demo"]);
  });

  it("оператор: справочник цен материалов — только с калькулятором материалов", () => {
    expect(more(OPERATOR, false, OFF)).not.toContain("/operator/materials");
    expect(more(OPERATOR, false, ON)).toContain("/operator/materials");
  });

  it("замерщик: «Замеры» — только при сценариях до договора (иначе страница — 404)", () => {
    expect(tabs(MEASURER, false, OFF)).toEqual(["/chats", "/profile"]);
    expect(tabs(MEASURER, false, ON)).toEqual(["/measurer", "/chats", "/profile"]);
  });
});

describe("currentItem: какая вкладка активна (aria-current)", () => {
  const { tabs: t, more: m } = navFor(EXECUTOR, false, ON);
  const all: NavItem[] = [...t, ...m];
  const active = (path: string, query = "") => currentItem(all, path, new URLSearchParams(query))?.href;

  it("главная — только на самой главной, а не на любой странице", () => {
    const client = navFor(CLIENT, false, ON);
    const clientActive = (path: string) => currentItem([...client.tabs, ...client.more], path, new URLSearchParams())?.href;
    expect(clientActive("/")).toBe("/");
    expect(clientActive("/requests/new")).toBe("/requests/new");
    expect(active("/")).toBeUndefined();
    expect(active("/catalog")).toBeUndefined();
  });

  it("«Заказы» — список сделок, «Финансы» — свой экран", () => {
    expect(active("/deals")).toBe("/deals");
    expect(active("/executor/finance")).toBe("/executor/finance");
  });

  it("вложенная страница подсвечивает свой раздел", () => {
    expect(active("/deals/abc")).toBe("/deals");
    expect(active("/executor/requests/42")).toBe("/executor/requests");
  });

  it("из двух подходящих разделов выбирается более точный", () => {
    expect(active("/executor/profile")).toBe("/executor/profile");
    expect(active("/profile")).toBe("/profile");
  });

  it("оператор на общем экране сделок (/deals, /deals/[id]) — активен раздел «Сделки»", () => {
    const op = navFor(OPERATOR, true, ON).more;
    const opActive = (path: string) => currentItem(op, path, new URLSearchParams())?.href;
    expect(opActive("/deals")).toBe("/operator/deals");
    expect(opActive("/deals/abc")).toBe("/operator/deals");
    expect(opActive("/operator/deals")).toBe("/operator/deals");
    expect(opActive("/operator")).toBe("/operator");
    expect(opActive("/dealsx")).toBeUndefined();
  });
});

describe("splitNav: что видно сразу, что — в «Ещё»", () => {
  const items = navFor(EXECUTOR, true, ON).tabs;
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
});
