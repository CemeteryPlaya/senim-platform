import { describe, expect, it } from "vitest";
import { activeHref, isTabRoot, navFor, operatorItems, visibleAction, type AppNav, type NavFeatures, type NavUser } from "./nav";
import { NAV_ICONS } from "./nav-icons";

const OFF: NavFeatures = { preContractFlows: false, inspiration: false, materialsCalculator: false };
const ON: NavFeatures = { preContractFlows: true, inspiration: true, materialsCalculator: true };

const client: NavUser = { role: "CLIENT", executor: null };
const executor = (status: "PENDING" | "APPROVED" | "REJECTED"): NavUser => ({ role: "EXECUTOR", executor: { status } });
const operator: NavUser = { role: "OPERATOR", executor: null };
const measurer: NavUser = { role: "MEASURER", executor: null };
const admin: NavUser = { role: "ADMIN", executor: null };

const labels = (nav: AppNav) => nav.tabs.map((t) => t.label);
const hrefs = (nav: AppNav) => nav.tabs.map((t) => t.href);

describe("navFor: сосредоточенная оболочка первых шагов", () => {
  it.each([client, executor("APPROVED"), executor("PENDING"), measurer, admin])("вошедший с непройденными шагами (%j): ни вкладок, ни разделов, ни действия", (user) => {
    expect(navFor(user, ON, { focus: true })).toEqual({ tabs: [], sections: [], guest: false, focus: true });
  });

  it("без признака, с focus: false и у гостя оболочка прежняя", () => {
    expect(navFor(client, OFF).focus).toBe(false);
    expect(navFor(client, OFF, { focus: false })).toEqual(navFor(client, OFF));
    expect(navFor(null, OFF).focus).toBe(false);
    // Гостю сосредоточенная оболочка не нужна: у него нет шагов.
    expect(navFor(null, OFF, { focus: true })).toEqual(navFor(null, OFF));
    expect(navFor(client, OFF).tabs).toHaveLength(5);
  });
});

describe("navFor: вкладки по ролям", () => {
  it("гость, телефон: Главная · Мастера · О сервисе · Войти", () => {
    const nav = navFor(null, OFF);
    expect(labels(nav)).toEqual(["Главная", "Мастера", "О сервисе", "Войти"]);
    expect(hrefs(nav)).toEqual(["/v2", "/v2/catalog", "/v2/about", "/v2/login"]);
    expect(nav.guest).toBe(true);
  });

  it("гость, шапка компьютера: разделы Мастера · О сервисе, «Войти» — действие справа, не раздел", () => {
    const nav = navFor(null, OFF);
    expect(nav.sections.map((s) => s.label)).toEqual(["Мастера", "О сервисе"]);
    expect(nav.sections.map((s) => s.href)).toEqual(["/v2/catalog", "/v2/about"]);
    expect(nav.action).toEqual({ href: "/v2/login", label: "Войти" });
  });

  it("подписи вкладок — одно-два слова", () => {
    const users = [null, client, executor("APPROVED"), executor("PENDING"), measurer, admin];
    for (const user of users) {
      for (const { label } of navFor(user, ON).tabs) expect(label.split(" ").length, label).toBeLessThanOrEqual(2);
    }
  });

  it("покупатель: Главная · Заявки · Сделки · Чат · Профиль; в шапке те же разделы и «Заказать мебель»", () => {
    const nav = navFor(client, OFF);
    expect(labels(nav)).toEqual(["Главная", "Заявки", "Сделки", "Чат", "Профиль"]);
    expect(hrefs(nav)).toEqual(["/v2", "/v2/requests", "/v2/deals", "/v2/chats", "/v2/profile"]);
    expect(nav.sections).toEqual(nav.tabs);
    expect(nav.action).toEqual({ href: "/v2/requests/new", label: "Заказать мебель" });
    expect(nav.guest).toBe(false);
  });

  it("покупатель, идущий к профилю мастера: «Главная» — анкета мастера · Профиль, без «Заказать мебель» и «Компании»", () => {
    const nav = navFor({ ...client, becomingMaster: true }, OFF);
    expect(labels(nav)).toEqual(["Главная", "Профиль"]);
    expect(hrefs(nav)).toEqual(["/v2/register/executor", "/v2/profile"]);
    expect(nav.sections).toEqual(nav.tabs);
    expect(nav.action).toBeUndefined();
    expect(activeHref(nav.tabs, "/v2/register/executor")).toBe("/v2/register/executor");
  });

  it("идущий к профилю мастера со своими сделками: Главная · Сделки · Профиль (путь к сделкам не теряется)", () => {
    const nav = navFor({ ...client, becomingMaster: true, hasBuyerDeals: true }, OFF);
    expect(labels(nav)).toEqual(["Главная", "Сделки", "Профиль"]);
    expect(hrefs(nav)).toEqual(["/v2/register/executor", "/v2/deals", "/v2/profile"]);
    expect(nav.action).toBeUndefined();
  });

  it("идущий к профилю мастера без сделок: «Сделок» нет; признак сделок без «идёт к мастеру» ничего не меняет", () => {
    expect(labels(navFor({ ...client, becomingMaster: true, hasBuyerDeals: false }, OFF))).toEqual(["Главная", "Профиль"]);
    expect(navFor({ ...client, hasBuyerDeals: true }, OFF)).toEqual(navFor(client, OFF));
  });

  it("признак «идёт к профилю мастера» ложный — у покупателя всё как раньше", () => {
    expect(navFor({ ...client, becomingMaster: false }, OFF)).toEqual(navFor(client, OFF));
    expect(navFor({ ...client, becomingMaster: false }, OFF).action).toEqual({ href: "/v2/requests/new", label: "Заказать мебель" });
  });

  it("мастер (одобрен): Главная · Заявки · Сделки · Чат · Профиль (финансы и компания — из профиля и главной)", () => {
    const nav = navFor(executor("APPROVED"), OFF);
    expect(labels(nav)).toEqual(["Главная", "Заявки", "Сделки", "Чат", "Профиль"]);
    expect(hrefs(nav)).toEqual(["/v2", "/v2/executor/requests", "/v2/deals", "/v2/chats", "/v2/profile"]);
    expect(nav.sections).toEqual(nav.tabs);
    expect(nav.action).toBeUndefined();
    expect(nav.guest).toBe(false);
  });

  it.each(["PENDING", "REJECTED"] as const)("мастер (%s): Главная (статус проверки) · Компания · Профиль", (status) => {
    const nav = navFor(executor(status), OFF);
    expect(labels(nav)).toEqual(["Главная", "Компания", "Профиль"]);
    expect(hrefs(nav)).toEqual(["/v2/register/executor", "/v2/executor/profile", "/v2/profile"]);
    expect(nav.sections).toEqual(nav.tabs);
    expect(nav.action).toBeUndefined();
  });

  it("мастер без профиля исполнителя — как на проверке", () => {
    expect(hrefs(navFor({ role: "EXECUTOR", executor: null }, OFF))).toEqual(["/v2/register/executor", "/v2/executor/profile", "/v2/profile"]);
  });

  it("вкладки мастера: активная — по адресу; корневые экраны — сами вкладки", () => {
    const tabs = navFor(executor("APPROVED"), OFF).tabs;
    expect(activeHref(tabs, "/v2")).toBe("/v2");
    expect(activeHref(tabs, "/v2/executor/requests/r1")).toBe("/v2/executor/requests");
    expect(activeHref(tabs, "/v2/deals/d1/sign/c1")).toBe("/v2/deals");
    expect(activeHref(tabs, "/v2/executor/finance")).toBeUndefined();
    expect(isTabRoot(tabs, "/v2/executor/requests")).toBe(true);
    expect(isTabRoot(tabs, "/v2/executor/requests/r1")).toBe(false);
  });

  it("мастер до одобрения: «Главная» — регистрация, она же активна на экранах регистрации", () => {
    const tabs = navFor(executor("PENDING"), OFF).tabs;
    expect(activeHref(tabs, "/v2/register/executor")).toBe("/v2/register/executor");
    expect(isTabRoot(tabs, "/v2/register/executor")).toBe(true);
    expect(activeHref(tabs, "/v2")).toBeUndefined();
  });

  it("оператор: вкладок и разделов шапки нет — меню слева по группам, главная сверху, профиль снизу", () => {
    const nav = navFor(operator, ON);
    expect(nav.tabs).toEqual([]);
    expect(nav.sections).toEqual([]);
    expect(nav.action).toBeUndefined();
    expect(nav.guest).toBe(false);
    const menu = nav.operator;
    if (!menu) throw new Error("нет меню оператора");
    expect(menu.home).toMatchObject({ href: "/v2/operator", label: "Главная" });
    expect(menu.profile).toMatchObject({ href: "/v2/profile", label: "Профиль" });
    expect(menu.groups.map((g) => [g.label, g.items.map((i) => i.href)])).toEqual([
      [
        "Очереди",
        ["/v2/operator/money", "/v2/operator/kyc", "/v2/operator/consents", "/v2/operator/executors", "/v2/operator/disputes", "/v2/operator/requests"],
      ],
      ["Сделки и отчёты", ["/v2/operator/deals", "/v2/operator/income", "/v2/operator/report", "/v2/operator/audit"]],
      ["Справочники и настройки", ["/v2/operator/furniture-types", "/v2/operator/materials", "/v2/operator/settings"]],
    ]);
    // 15 пунктов, как в v1 без прежней страницы показа; адреса и значки не повторяются, у каждого значка есть компонент.
    const items = operatorItems(menu);
    expect(items).toHaveLength(15);
    expect(new Set(items.map((i) => i.href)).size).toBe(15);
    expect(new Set(items.map((i) => i.icon)).size).toBe(15);
    for (const item of items) expect(NAV_ICONS[item.icon]).toBeDefined();
  });

  it("оператор: «Цены материалов» — только при включённом флаге калькулятора материалов", () => {
    const hrefsOf = (f: NavFeatures) => {
      const menu = navFor(operator, f).operator;
      return menu ? operatorItems(menu).map((i) => i.href) : [];
    };
    expect(hrefsOf(ON)).toContain("/v2/operator/materials");
    expect(hrefsOf(OFF)).not.toContain("/v2/operator/materials");
    expect(navFor(operator, OFF).operator?.groups.at(-1)?.items.map((i) => i.href)).toEqual(["/v2/operator/furniture-types", "/v2/operator/settings"]);
  });

  it("оператор на втором шаге входа — сосредоточенная оболочка без меню", () => {
    expect(navFor(operator, ON, { focus: true })).toEqual({ tabs: [], sections: [], guest: false, focus: true });
  });

  it("оператор: главная подсвечена только на самой главной, раздел — на своих вложенных экранах", () => {
    const menu = navFor(operator, ON).operator;
    if (!menu) throw new Error("нет меню оператора");
    const items = operatorItems(menu);
    const exact = [menu.home.href];
    expect(activeHref(items, "/v2/operator", exact)).toBe("/v2/operator");
    expect(activeHref(items, "/v2/operator/money", exact)).toBe("/v2/operator/money");
    expect(activeHref(items, "/v2/operator/executors/7", exact)).toBe("/v2/operator/executors");
    expect(activeHref(items, "/v2/operator/mfa", exact)).toBeUndefined();
    expect(activeHref(items, "/v2/profile", exact)).toBe("/v2/profile");
  });

  it("замерщик: «Замеры» только при включённом флаге сценариев до договора", () => {
    expect(labels(navFor(measurer, ON))).toEqual(["Замеры", "Чат", "Профиль"]);
    expect(hrefs(navFor(measurer, ON))).toEqual(["/v2/measurer", "/v2/chats", "/v2/profile"]);
    expect(labels(navFor(measurer, OFF))).toEqual(["Чат", "Профиль"]);
  });

  it("администратор: Статистика · Данные · Профиль; в шапке те же разделы, без «Заказать мебель» и без меню оператора", () => {
    for (const f of [OFF, ON]) {
      const nav = navFor(admin, f);
      expect(labels(nav)).toEqual(["Статистика", "Данные", "Профиль"]);
      expect(hrefs(nav)).toEqual(["/v2/admin", "/v2/admin/data", "/v2/profile"]);
      expect(nav.tabs.map((t) => t.icon)).toEqual(["stats", "data", "profile"]);
      expect(nav.sections).toEqual(nav.tabs);
      expect(nav.action).toBeUndefined();
      expect(nav.operator).toBeUndefined();
      expect(nav.guest).toBe(false);
    }
  });

  it("администратор: «Статистика» подсвечена на главной админки, «Данные» — на таблицах и карточках", () => {
    const { tabs } = navFor(admin, OFF);
    expect(activeHref(tabs, "/v2/admin")).toBe("/v2/admin");
    expect(activeHref(tabs, "/v2/admin/data")).toBe("/v2/admin/data");
    expect(activeHref(tabs, "/v2/admin/data/User/u1")).toBe("/v2/admin/data");
    expect(isTabRoot(tabs, "/v2/admin/data")).toBe(true);
    expect(isTabRoot(tabs, "/v2/admin/data/User")).toBe(false);
  });

  it("ни в одной роли больше пяти вкладок, у каждой вкладки своя иконка и адрес", () => {
    const users = [null, client, executor("APPROVED"), executor("PENDING"), executor("REJECTED"), operator, measurer, admin];
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

  it("гость на главной /v2 — подсвечена «Главная» (раньше у гостя не было вкладки, совпадающей с /v2)", () => {
    const guest = navFor(null, OFF);
    expect(activeHref(guest.tabs, "/v2")).toBe("/v2");
    expect(activeHref(guest.tabs, "/v2/catalog/5")).toBe("/v2/catalog");
    expect(activeHref(guest.sections, "/v2/about")).toBe("/v2/about");
  });
});

describe("visibleAction: «Войти» в шапке компьютера не показывается на экранах входа", () => {
  const guest = navFor(null, OFF);
  it("на /v2/login и его шагах действия нет", () => {
    expect(visibleAction(guest.action, "/v2/login")).toBeUndefined();
    expect(visibleAction(guest.action, "/v2/login/phone")).toBeUndefined();
  });
  it("на остальных страницах гостя кнопка остаётся; /v2/loginx — не вход", () => {
    expect(visibleAction(guest.action, "/v2")?.label).toBe("Войти");
    expect(visibleAction(guest.action, "/v2/about")?.href).toBe("/v2/login");
    expect(visibleAction(guest.action, "/v2/loginx")?.href).toBe("/v2/login");
    expect(visibleAction(guest.action, null)?.href).toBe("/v2/login");
  });
  it("другие действия (заказчика) не затрагиваются", () => {
    const client = navFor({ role: "CLIENT", executor: null }, OFF);
    expect(visibleAction(client.action, "/v2/login")).toEqual(client.action);
    expect(visibleAction(undefined, "/v2/login")).toBeUndefined();
  });
});

describe("isTabRoot: корневой экран вкладки", () => {
  const tabs = navFor(client, OFF).tabs;

  it.each(["/v2", "/v2/requests", "/v2/deals", "/v2/chats", "/v2/profile", "/v2/deals/"])("%s — корневой", (path) => {
    expect(isTabRoot(tabs, path)).toBe(true);
  });

  it.each(["/v2/deals/7", "/v2/requests/new", "/v2/profile/data", "/v2/notifications", "/v2/catalog", "/v2x", "/deals", "/", ""])(
    "%s — нет",
    (path) => {
      expect(isTabRoot(tabs, path)).toBe(false);
    },
  );

  it("нет адреса и нет вкладок — нет", () => {
    expect(isTabRoot(tabs, null)).toBe(false);
    expect(isTabRoot([], "/v2")).toBe(false);
  });
});
