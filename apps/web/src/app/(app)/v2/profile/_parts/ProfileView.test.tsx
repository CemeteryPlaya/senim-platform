import { describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import type { Device } from "@/platform/device";

// Действия сервера в статическом рендере не вызываются; их модули тянут env и базу.
vi.mock("../../../_shell/session-actions", () => ({ logout: vi.fn() }));
vi.mock("../../../_shell/theme-actions", () => ({ chooseTheme: vi.fn(async () => undefined) }));

const { ProfileView } = await import("./ProfileView");
const { profileModel, roleLinks } = await import("./profile-view");

const t = ru.app.profile;

type User = Parameters<typeof profileModel>[0];
const client: User = { role: "CLIENT", roles: ["CLIENT"], fullName: "Сапаров Ерлан", phone: "+77001234567" };
const render = (user: User, device: Device) => html(<ProfileView model={profileModel(user)} theme="system" device={device} />);

describe("profileModel", () => {
  it("имя как записано, телефон форматированный, активная роль строкой", () => {
    const m = profileModel(client);
    expect(m.name).toBe("Сапаров Ерлан");
    expect(m.phone).toBe("+7 700 123 45 67");
    expect(m.roleLine).toBe("Вы сейчас — покупатель");
  });

  it("без имени — «Имя не указано»", () => {
    expect(profileModel({ ...client, fullName: null }).name).toBe(t.nameMissing);
  });

  it("разделы покупателя и мастера — контакты, мои данные, уведомления, помощь; у оператора только уведомления и помощь", () => {
    expect(profileModel(client).sections.map((s) => s.href)).toEqual(["/v2/profile/contacts", "/v2/profile/data", "/v2/notifications", "/v2/help"]);
    expect(profileModel({ ...client, role: "OPERATOR", roles: ["OPERATOR"] }).sections.map((s) => s.href)).toEqual(["/v2/notifications", "/v2/help"]);
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
  it("одобренный: компания, документы, счёт, портфолио, финансы, публичный профиль; общие разделы после них", () => {
    expect(hrefs(master("APPROVED"))).toEqual([...WORK, "/v2/executor/finance", "/v2/executors/17"]);
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
    for (const href of [...WORK, "/v2/executor/finance", "/v2/executors/17"]) expect(out).toContain(`href="${href}"`);
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

  it("раздел «Роль» только когда есть что менять", () => {
    expect(render(client, device)).toContain(`>${t.role.title}</h2>`);
    expect(render({ ...client, role: "OPERATOR", roles: ["OPERATOR"] }, device)).not.toContain(`>${t.role.title}</h2>`);
  });
});
