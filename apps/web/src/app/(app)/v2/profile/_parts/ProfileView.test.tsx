import { describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import type { BuyerHistory } from "@/modules/requests";
import type { Device } from "@/platform/device";

// Действия сервера в статическом рендере не вызываются; их модули тянут env и базу.
vi.mock("../../../_shell/session-actions", () => ({ logout: vi.fn() }));
vi.mock("../../../_shell/theme-actions", () => ({ chooseTheme: vi.fn(async () => undefined) }));

const { ProfileView } = await import("./ProfileView");
const { profileModel, roleLinks } = await import("./profile-view");

const t = ru.app.profile;

type User = Parameters<typeof profileModel>[0];
const client: User = { role: "CLIENT", roles: ["CLIENT"], fullName: "Сапаров Ерлан", phone: "+77001234567" };
const render = (user: User, device: Device, history?: BuyerHistory) => html(<ProfileView model={profileModel(user, history)} theme="system" device={device} />);

describe("profileModel", () => {
  it("имя как записано, телефон форматированный; активная роль строкой — только когда ролей две", () => {
    const m = profileModel(client);
    expect(m.name).toBe("Сапаров Ерлан");
    expect(m.phone).toBe("+7 700 123 45 67");
    expect(m.roleLine).toBeNull();
    expect(profileModel({ ...client, roles: ["CLIENT", "EXECUTOR"] }).roleLine).toBe("Вы сейчас — покупатель");
    expect(profileModel({ ...client, role: "EXECUTOR", roles: ["EXECUTOR"] }).roleLine).toBeNull();
  });

  it("без имени — «Имя не указано»", () => {
    expect(profileModel({ ...client, fullName: null }).name).toBe(t.nameMissing);
  });

  it("разделы покупателя и мастера — контакты, мои данные, уведомления, помощь; у сотрудников только уведомления", () => {
    expect(profileModel(client).sections.map((s) => s.href)).toEqual(["/v2/profile/contacts", "/v2/profile/data", "/v2/notifications", "/v2/help"]);
    // Сотрудникам «Помощь» не показывается: её ответы — для покупателя и мастера.
    expect(profileModel({ ...client, role: "OPERATOR", roles: ["OPERATOR"] }).sections.map((s) => s.href)).toEqual(["/v2/notifications"]);
    expect(profileModel({ ...client, role: "MEASURER", roles: ["MEASURER"] }).sections.map((s) => s.href)).toEqual(["/v2/notifications"]);
  });

  it("роль: только заказчик — «Стать мастером» (регистрация мастера)", () => {
    expect(roleLinks(client)).toEqual([{ label: t.role.becomeMaster, href: "/v2/register/executor" }]);
  });

  it("роль: выдана и мастер — переключение на мастера с возвратом в профиль, «Стать мастером» нет", () => {
    expect(roleLinks({ role: "CLIENT", roles: ["CLIENT", "EXECUTOR"] })).toEqual([
      { label: t.role.switchTo.EXECUTOR, href: `/v2/switch-role?to=EXECUTOR&returnTo=${encodeURIComponent("/v2/profile")}` },
    ]);
  });

  it("роль: активный мастер с ролью покупателя — переключение на покупателя", () => {
    expect(roleLinks({ role: "EXECUTOR", roles: ["CLIENT", "EXECUTOR"] }).map((r) => r.label)).toEqual([t.role.switchTo.CLIENT]);
  });

  it("оператору и замерщику роли не предлагаются", () => {
    expect(roleLinks({ role: "OPERATOR", roles: ["OPERATOR"] })).toEqual([]);
  });
});

const master = (status: "PENDING" | "APPROVED" | "REJECTED" | null): User => ({
  role: "EXECUTOR",
  roles: ["CLIENT", "EXECUTOR"],
  fullName: "Мастер Ерлан",
  phone: "+77001234567",
  executor: status ? { id: "e1", publicNumber: 17, status } : null,
});
const hrefs = (user: User) => profileModel(user).work.map((r) => r.href);
const WORK = ["/v2/executor/profile", "/v2/executor/profile/kyc", "/v2/executor/profile/payout", "/v2/executor/portfolio"];

describe("разделы мастера", () => {
  it("одобренный: компания, документы, счёт, портфолио, финансы (публичная страница — в «Компании»); общие разделы после них", () => {
    expect(hrefs(master("APPROVED"))).toEqual([...WORK, "/v2/executor/finance"]);
    expect(profileModel(master("APPROVED")).sections.map((s) => s.href)).toEqual(["/v2/profile/contacts", "/v2/profile/data", "/v2/notifications", "/v2/help"]);
  });

  it("на проверке и после отказа: без финансов и публичного профиля, со ссылкой на статус проверки", () => {
    for (const status of ["PENDING", "REJECTED"] as const) expect(hrefs(master(status))).toEqual([...WORK, "/v2/register/executor"]);
  });

  it("роль мастера без анкеты — ссылка на регистрацию", () => {
    expect(hrefs(master(null))).toEqual(["/v2/register/executor"]);
  });

  it("покупатель, в том числе с профилем мастера, разделов мастера не видит", () => {
    expect(profileModel(client).work).toEqual([]);
    expect(profileModel({ ...master("APPROVED"), role: "CLIENT" }).work).toEqual([]);
  });

  it.each(["mobile", "desktop"] as const)("%s: раздел «Работа мастера» с ссылками; у покупателя его нет; главного действия нет", (device) => {
    const out = render(master("APPROVED"), device);
    expect(out).toContain(`>${ru.app.masterProfile.sectionsTitle}</h2>`);
    for (const href of [...WORK, "/v2/executor/finance"]) expect(out).toContain(`href="${href}"`);
    expect(out).not.toContain('href="/v2/executors/17"');
    expect(count(out, "data-primary-action")).toBe(0);
    expect(count(out, "<h1")).toBe(1);
    expect(render(client, device)).not.toContain(ru.app.masterProfile.sectionsTitle);
  });
});

describe.each(["mobile", "desktop"] as const)("ProfileView (%s)", (device) => {
  it("один h1, нет главного действия, разделы ссылками со шевроном, «Оформление» и «Выйти»", () => {
    const out = render(client, device);
    expect(count(out, "<h1")).toBe(1);
    expect(count(out, "data-primary-action")).toBe(0);
    for (const href of ["/v2/profile/contacts", "/v2/profile/data", "/v2/notifications", "/v2/help"]) expect(out).toContain(`href="${href}"`);
    expect(out).toContain(`>${t.theme.title}</h2>`);
    expect(out).toContain(ru.app.shell.logout);
    expect(out).toContain("Сапаров Ерлан");
    expect(out).toContain("+7 700 123 45 67");
  });

  it("смена роли — только когда есть что менять: на компьютере разделом «Роль», на телефоне — последней строкой разделов", () => {
    const out = render(client, device);
    expect(out).toContain('href="/v2/register/executor"');
    expect(out).toContain(t.role.becomeMaster);
    if (device === "desktop") expect(out).toContain(`>${t.role.title}</h2>`);
    else {
      expect(out).not.toContain(`>${t.role.title}</h2>`);
      expect(out.indexOf(t.role.becomeMaster)).toBeGreaterThan(out.indexOf('href="/v2/help"'));
    }
    const staff = render({ ...client, role: "OPERATOR", roles: ["OPERATOR"] }, device);
    expect(staff).not.toContain(`>${t.role.title}</h2>`);
    expect(staff).not.toContain(t.role.becomeMaster);
  });

  it("«Оформление»: подпись переключателя — только для диктора", () => {
    expect(render(client, device)).toContain(`<legend class="sr-only">${t.theme.legend}</legend>`);
  });
});

const row = (over: Partial<BuyerHistory["rows"][number]>): BuyerHistory["rows"][number] => ({
  requestId: "r1",
  title: "Кухня",
  executorLabel: null,
  priceTiyn: null,
  state: "progress",
  href: "/requests/r1",
  at: new Date("2026-11-10T10:00:00Z"),
  ...over,
});
const history: BuyerHistory = {
  counts: { orders: 4, deals: 3, successful: 1 },
  rows: [
    row({ requestId: "a", title: "Шкаф", state: "success", executorLabel: "Мастер Асет", priceTiyn: 12_000_000n, href: "/deals/d1" }),
    row({ requestId: "b", title: "Стол", state: "failed", href: "/deals/d2" }),
    row({ requestId: "c", title: "Кровать", state: "cancelled" }),
    row({ requestId: "d", title: "Полка", state: "progress", href: "/requests/d" }),
  ],
};
const h = t.history;

describe("история покупателя", () => {
  it("модель: счётчики и строки в порядке модуля, адреса v2, тон по статусу", () => {
    const m = profileModel(client, history).history!;
    expect(m.stats).toEqual([
      { label: h.stats.orders, value: 4 },
      { label: h.stats.deals, value: 3 },
      { label: h.stats.successful, value: 1 },
    ]);
    expect(m.rows.map((r) => r.title)).toEqual(["Шкаф", "Стол", "Кровать", "Полка"]);
    expect(m.rows.map((r) => r.href)).toEqual(["/v2/deals/d1", "/v2/deals/d2", "/v2/requests/r1", "/v2/requests/d"]);
    // Плашка — только у законченных; идущий заказ без пометки (жёлтый — только «нужно ваше действие»).
    expect(m.rows.map((r) => r.status)).toEqual([
      { text: h.status.success, tone: "accent" },
      { text: h.status.failed, tone: "danger" },
      { text: h.status.cancelled, tone: "neutral" },
      null,
    ]);
  });

  it("без истории (мастер, сотрудник, не передана) — модель без блока", () => {
    expect(profileModel(client).history).toBeNull();
    expect(profileModel(master("APPROVED"), history).history).toBeNull();
    expect(profileModel({ ...client, role: "OPERATOR", roles: ["OPERATOR"] }, history).history).toBeNull();
  });

  it.each(["mobile", "desktop"] as const)("%s: счётчики, строки-ссылки со статусом, мастер и сумма, вопросы и ответы внизу", (device) => {
    const out = render(client, device, history);
    expect(out).toContain(`>${h.title}</h2>`);
    for (const label of [h.stats.orders, h.stats.deals, h.stats.successful]) expect(out).toContain(label);
    for (const href of ["/v2/deals/d1", "/v2/deals/d2", "/v2/requests/r1", "/v2/requests/d"]) expect(out).toContain(`href="${href}"`);
    for (const label of Object.values(h.status)) expect(count(out, `>${label}</span>`)).toBe(1);
    expect(out).not.toContain("В процессе");
    // Три числа сводки в одну строку.
    expect(out).toMatch(/role="group" aria-label="[^"]*" class="[^"]*\*:last:flex-1/);
    expect(out).toContain("Мастер Асет");
    expect(out).toContain("120");
    expect(count(out, "data-primary-action")).toBe(0);
    expect(count(out, "<h1")).toBe(1);
    // Вопросы и ответы — после выхода из аккаунта нет, после истории — да; ответ закрыт, но в разметке.
    expect(out).toContain(`>${h.faq.title}</h2>`);
    expect(out).toMatch(/<details(?![^>]*\sopen)/);
    expect(out).toContain(h.faq.statuses.title);
    for (const line of h.faq.statuses.paragraphs) expect(out).toContain(line);
    expect(out.indexOf(h.title)).toBeLessThan(out.indexOf(h.faq.title));
    expect(out.indexOf(h.faq.title)).toBeLessThan(out.indexOf(ru.app.shell.logout));
  });

  it("пустая история — короткий текст вместо списка; счётчики нули", () => {
    const out = render(client, "mobile", { counts: { orders: 0, deals: 0, successful: 0 }, rows: [] });
    expect(out).toContain(h.empty.title);
    expect(out).toContain(h.empty.body);
  });

  it("у мастера и без истории — прежний вид, без истории и вопросов", () => {
    for (const out of [render(master("APPROVED"), "mobile", history), render(client, "mobile")]) {
      expect(out).not.toContain(h.title);
      expect(out).not.toContain(h.faq.title);
      expect(count(out, "<details")).toBe(0);
    }
  });
});
