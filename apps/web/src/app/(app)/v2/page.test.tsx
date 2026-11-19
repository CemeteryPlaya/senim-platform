import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";

const h = vi.hoisted(() => ({
  shell: { user: null as { role: "CLIENT" | "EXECUTOR" | "OPERATOR"; executor?: null } | null, unavailable: false },
  device: "desktop" as "mobile" | "desktop",
  chosen: null as "CLIENT" | "EXECUTOR" | null,
}));

vi.mock("@/modules/identity", () => ({ getShellUser: async () => h.shell }));
// Барьер первых шагов проверяет onboarding-gate.test.tsx; здесь вошедший их уже прошёл.
vi.mock("../_shell/auth", () => ({
  requireV2User: async () => h.shell.user,
  masterStatusOf: () => "approved",
  homeFor: (user: { role: string }) => (user.role === "OPERATOR" ? "/v2/operator" : "/v2"),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`redirect:${href}`);
  },
}));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("../_shell/role-cookie", () => ({ recallRole: async () => h.chosen }));
// Главная покупателя читает базу — её проверяет page.int.test.ts; здесь только выбор по роли.
vi.mock("./_home/BuyerHome", () => ({ BuyerHome: ({ device }: { device: string }) => <h1>покупатель-{device}</h1> }));

vi.mock("./_home/MasterHome", () => ({ MasterHome: ({ device, status }: { device: string; status: string }) => <h1>мастер-{status}-{device}</h1> }));

const { default: V2Home } = await import("./(home)/page");

beforeEach(() => {
  h.shell = { user: null, unavailable: false };
  h.device = "desktop";
  h.chosen = null;
});

describe("главная /v2", () => {
  it("гость видит лендинг: заголовок-обещание и вход", async () => {
    const out = html(await V2Home());
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(ru.app.guest.home.title);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).toContain('href="/v2/login?role=client"');
  });

  it("гость на телефоне получает ту же главную", async () => {
    h.device = "mobile";
    const out = html(await V2Home());
    expect(count(out, "<h1")).toBe(1);
    expect(out).toContain("mobile:sticky");
  });

  it("вошедший с активной ролью заказчика видит главную покупателя", async () => {
    h.shell = { user: { role: "CLIENT" }, unavailable: false };
    h.device = "mobile";
    expect(html(await V2Home())).toContain("покупатель-mobile");
  });

  it("покупатель без профиля мастера, выбравший «Я мастер», главную покупателя не видит — на анкету мастера", async () => {
    h.shell = { user: { role: "CLIENT", executor: null }, unavailable: false };
    h.chosen = "EXECUTOR";
    await expect(V2Home()).rejects.toThrow("redirect:/v2/register/executor");
  });

  it("покупатель с выбором «Заказать мебель» видит свою главную", async () => {
    h.shell = { user: { role: "CLIENT", executor: null }, unavailable: false };
    h.chosen = "CLIENT";
    expect(html(await V2Home())).toContain("покупатель-desktop");
  });

  it("вошедший с активной ролью мастера видит главную мастера", async () => {
    h.shell = { user: { role: "EXECUTOR" }, unavailable: false };
    h.device = "mobile";
    expect(html(await V2Home())).toContain("мастер-approved-mobile");
  });

  it("оператор уходит на свою главную", async () => {
    h.shell = { user: { role: "OPERATOR" }, unavailable: false };
    await expect(V2Home()).rejects.toThrow("redirect:/v2/operator");
  });
});

describe("главная /v2: identity недоступен", () => {
  it("гость при unavailable: true по-прежнему видит лендинг", async () => {
    h.shell = { user: null, unavailable: true };
    const out = html(await V2Home());
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(ru.app.guest.home.title);
    expect(count(out, "data-primary-action")).toBe(1);
  });
});
