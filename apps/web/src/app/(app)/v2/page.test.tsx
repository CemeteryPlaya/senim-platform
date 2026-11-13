import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";

const h = vi.hoisted(() => ({
  shell: { user: null as { role: "CLIENT" | "EXECUTOR" } | null, unavailable: false },
  device: "desktop" as "mobile" | "desktop",
}));

vi.mock("@/modules/identity", () => ({ getShellUser: async () => h.shell }));
// Барьер первых шагов проверяет onboarding-gate.test.tsx; здесь вошедший их уже прошёл.
vi.mock("../_shell/auth", () => ({ requireV2User: async () => h.shell.user }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
// Главная покупателя читает базу — её проверяет page.int.test.ts; здесь только выбор по роли.
vi.mock("./_home/BuyerHome", () => ({ BuyerHome: ({ device }: { device: string }) => <h1>покупатель-{device}</h1> }));

const { default: V2Home } = await import("./page");

beforeEach(() => {
  h.shell = { user: null, unavailable: false };
  h.device = "desktop";
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

  it("вошедший в другой роли пока видит прежний образец", async () => {
    h.shell = { user: { role: "EXECUTOR" }, unavailable: false };
    const out = html(await V2Home());
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(ru.app.shell.preview.title);
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
