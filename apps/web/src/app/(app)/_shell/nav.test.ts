import { describe, expect, it } from "vitest";
import { activeHref, navFor, type AppNav, type NavFeatures, type NavUser } from "./nav";

const OFF: NavFeatures = { preContractFlows: false, inspiration: false, materialsCalculator: false };
const ON: NavFeatures = { preContractFlows: true, inspiration: true, materialsCalculator: true };

const client: NavUser = { role: "CLIENT", executor: null };
const executor = (status: "PENDING" | "APPROVED" | "REJECTED"): NavUser => ({ role: "EXECUTOR", executor: { status } });
const operator: NavUser = { role: "OPERATOR", executor: null };
const measurer: NavUser = { role: "MEASURER", executor: null };

const labels = (nav: AppNav) => nav.tabs.map((t) => t.label);
const hrefs = (nav: AppNav) => nav.tabs.map((t) => t.href);

describe("navFor: вкладки по ролям", () => {
  it("гость: Мастера · Как это работает · Войти", () => {
    const nav = navFor(null, OFF);
    expect(labels(nav)).toEqual(["Мастера", "Как это работает", "Войти"]);
    expect(hrefs(nav)).toEqual(["/v2/catalog", "/v2/about", "/v2/login"]);
    expect(nav.guest).toBe(true);
    expect(nav.primary).toBeUndefined();
  });

  it("покупатель: Главная · Заявки · Сделки · Чат · Профиль; в шапке — «Новая заявка»", () => {
    const nav = navFor(client, OFF);
    expect(labels(nav)).toEqual(["Главная", "Заявки", "Сделки", "Чат", "Профиль"]);
    expect(hrefs(nav)).toEqual(["/v2", "/v2/requests", "/v2/deals", "/v2/chats", "/v2/profile"]);
    expect(nav.primary).toEqual({ href: "/v2/requests/new", label: "Новая заявка" });
    expect(nav.guest).toBe(false);
  });

  it("мастер (одобрен): Заявки · Заказы · Чат · Финансы · Профиль", () => {
    const nav = navFor(executor("APPROVED"), OFF);
    expect(labels(nav)).toEqual(["Заявки", "Заказы", "Чат", "Финансы", "Профиль"]);
    expect(hrefs(nav)).toEqual(["/v2/executor/requests", "/v2/deals", "/v2/chats", "/v2/executor/finance", "/v2/profile"]);
    expect(nav.primary).toBeUndefined();
    expect(nav.guest).toBe(false);
  });

  it.each(["PENDING", "REJECTED"] as const)("мастер (%s): Компания · Портфолио · Профиль", (status) => {
    const nav = navFor(executor(status), OFF);
    expect(labels(nav)).toEqual(["Компания", "Портфолио", "Профиль"]);
    expect(hrefs(nav)).toEqual(["/v2/executor/profile", "/v2/executor/portfolio", "/v2/profile"]);
    expect(nav.primary).toBeUndefined();
  });

  it("мастер без профиля исполнителя — как на проверке", () => {
    expect(hrefs(navFor({ role: "EXECUTOR", executor: null }, OFF))).toEqual([
      "/v2/executor/profile",
      "/v2/executor/portfolio",
      "/v2/profile",
    ]);
  });

  it("оператор: вкладок нет (оболочка оператора — этап 5)", () => {
    const nav = navFor(operator, ON);
    expect(nav.tabs).toEqual([]);
    expect(nav.primary).toBeUndefined();
    expect(nav.guest).toBe(false);
  });

  it("замерщик: «Замеры» только при включённом флаге сценариев до договора", () => {
    expect(labels(navFor(measurer, ON))).toEqual(["Замеры", "Чат", "Профиль"]);
    expect(hrefs(navFor(measurer, ON))).toEqual(["/v2/measurer", "/v2/chats", "/v2/profile"]);
    expect(labels(navFor(measurer, OFF))).toEqual(["Чат", "Профиль"]);
  });

  it("ни в одной роли больше пяти вкладок, у каждой вкладки своя иконка и адрес", () => {
    const users = [null, client, executor("APPROVED"), executor("PENDING"), executor("REJECTED"), operator, measurer];
    for (const user of users) {
      for (const f of [OFF, ON]) {
        const { tabs } = navFor(user, f);
        expect(tabs.length).toBeLessThanOrEqual(5);
        expect(new Set(tabs.map((t) => t.href)).size).toBe(tabs.length);
        expect(new Set(tabs.map((t) => t.icon)).size).toBe(tabs.length);
      }
    }
  });
});

describe("activeHref: активная вкладка по адресу", () => {
  const tabs = navFor(client, OFF).tabs;

  it("главная подсвечивается только на самой главной", () => {
    expect(activeHref(tabs, "/v2")).toBe("/v2");
    expect(activeHref(tabs, "/v2/settings")).toBeUndefined();
  });

  it("вложенный экран подсвечивает свой раздел", () => {
    expect(activeHref(tabs, "/v2/deals")).toBe("/v2/deals");
    expect(activeHref(tabs, "/v2/deals/42")).toBe("/v2/deals");
    expect(activeHref(tabs, "/v2/requests/new")).toBe("/v2/requests");
  });

  it("совпадение только по целому сегменту", () => {
    expect(activeHref(tabs, "/v2/dealsx")).toBeUndefined();
  });

  it("выбирается самый точный раздел", () => {
    const items = [
      { href: "/v2/executor", label: "a", icon: "company" as const },
      { href: "/v2/executor/requests", label: "b", icon: "requests" as const },
    ];
    expect(activeHref(items, "/v2/executor/requests/7")).toBe("/v2/executor/requests");
  });

  it("без адреса (вне роутера) ничего не подсвечено", () => {
    expect(activeHref(tabs, null)).toBeUndefined();
  });
});
