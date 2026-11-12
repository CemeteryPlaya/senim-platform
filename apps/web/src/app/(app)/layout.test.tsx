import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { TOKENS } from "@/kit/tokens";

type ShellUser = { role: "CLIENT" | "EXECUTOR" | "OPERATOR" | "MEASURER"; fullName: string | null; executor: null };

const h = vi.hoisted(() => ({
  theme: "system" as "system" | "light" | "dark",
  device: "mobile" as "mobile" | "desktop",
  shell: { user: null as ShellUser | null, unavailable: false },
  pathname: "/v2/deals/7",
  search: "tab=docs",
}));

vi.mock("@/kit/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/kit/theme")>()),
  getTheme: async () => h.theme,
}));
vi.mock("@/kit/fonts", () => ({ fontVariables: "font-vars" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("@/platform/features", () => ({
  features: () => ({ preContractFlows: false, inspiration: false, materialsCalculator: false }),
}));
vi.mock("@/modules/identity", () => ({ getShellUser: async () => h.shell }));
vi.mock("./_shell/session-actions", () => ({ logout: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(h.search),
}));

const { default: AppLayout, generateViewport } = await import("./layout");

async function render(): Promise<string> {
  return renderToStaticMarkup(await AppLayout({ children: <p>page-body</p> }));
}
const htmlTag = (out: string): string => {
  const at = out.indexOf("<html");
  return out.slice(at, out.indexOf(">", at) + 1);
};

beforeEach(() => {
  h.theme = "system";
  h.device = "mobile";
  h.shell = { user: null, unavailable: false };
});

describe("корневой layout v2", () => {
  it("телефон: data-device=mobile, панель вкладок, без шапки", async () => {
    h.shell = { user: { role: "CLIENT", fullName: "Айгерим", executor: null }, unavailable: false };
    const out = await render();
    expect(htmlTag(out)).toContain('data-device="mobile"');
    expect(out).toContain("data-tab-bar");
    expect(out).not.toContain("data-top-bar");
    expect(out).toContain("page-body");
  });

  it("компьютер: data-device=desktop, шапка, без панели вкладок", async () => {
    h.device = "desktop";
    h.shell = { user: { role: "CLIENT", fullName: "Айгерим", executor: null }, unavailable: false };
    const out = await render();
    expect(htmlTag(out)).toContain('data-device="desktop"');
    expect(out).toContain("data-top-bar");
    expect(out).not.toContain("data-tab-bar");
  });

  it.each(["mobile", "desktop"] as const)("%s: место для тостов подключено", async (device) => {
    h.device = device;
    expect(await render()).toContain(`aria-label="${ru.app.kit.notifications}`);
  });

  it("тема по куке: data-theme и color-scheme на <html>", async () => {
    h.theme = "dark";
    const dark = htmlTag(await render());
    expect(dark).toContain('data-theme="dark"');
    expect(dark).toMatch(/style="color-scheme:\s*dark"/);
    h.theme = "system";
    const system = htmlTag(await render());
    expect(system).not.toContain("data-theme");
    expect(system).toMatch(/style="color-scheme:\s*light dark"/);
  });

  it("identity недоступен — предупреждение в оболочке", async () => {
    h.shell = { user: null, unavailable: true };
    expect(await render()).toContain(ru.common.errors.unavailable);
  });

  it("оператор: вместо страниц v2 — заглушка со ссылкой на тот же адрес в v1", async () => {
    h.device = "desktop";
    h.shell = { user: { role: "OPERATOR", fullName: null, executor: null }, unavailable: false };
    const out = await render();
    expect(out).not.toContain("page-body");
    expect(out).toContain(ru.app.shell.movingTitle);
    expect(out).toContain('href="/deals/7?tab=docs"');
    expect(out).toContain("data-top-bar");
  });
});

describe("generateViewport: цвет строки состояния по теме", () => {
  it("как в системе — пара для светлой и тёмной", async () => {
    h.theme = "system";
    expect((await generateViewport()).themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: TOKENS.light.canvas },
      { media: "(prefers-color-scheme: dark)", color: TOKENS.dark.canvas },
    ]);
  });

  it.each(["light", "dark"] as const)("выбрана %s — одно значение её фона", async (theme) => {
    h.theme = theme;
    expect((await generateViewport()).themeColor).toBe(TOKENS[theme].canvas);
  });
});

describe("generateViewport: безопасные зоны", () => {
  it("телефон: viewport-fit=cover — env(safe-area-inset-*) получает настоящие значения", async () => {
    h.device = "mobile";
    expect((await generateViewport()).viewportFit).toBe("cover");
  });

  it("компьютер: viewport-fit не задаётся", async () => {
    h.device = "desktop";
    expect(await generateViewport()).not.toHaveProperty("viewportFit");
  });
});
