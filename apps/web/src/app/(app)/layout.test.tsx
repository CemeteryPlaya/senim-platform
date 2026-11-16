import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { PageTitle } from "@/kit";
import { TOKENS } from "@/kit/tokens";
import { consentDocument } from "@/modules/identity";

type ShellUser = {
  role: "CLIENT" | "EXECUTOR" | "OPERATOR" | "MEASURER";
  roles: string[];
  fullName: string | null;
  iinLast4: string | null;
  emailVerified: boolean;
  executor: null;
  mfa: { required: boolean; verifiedAt: Date | null };
  consents: { version: string }[];
  consentRevocationOpen: boolean;
};

const h = vi.hoisted(() => ({
  theme: "system" as "system" | "light" | "dark",
  device: "mobile" as "mobile" | "desktop",
  shell: { user: null as ShellUser | null, unavailable: false },
  unread: 4 as number | Error,
  unreadCalls: [] as string[],
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
vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/identity")>()),
  getShellUser: async () => h.shell,
}));
vi.mock("@/modules/notifications", () => ({
  unreadCount: async (userId: string) => {
    h.unreadCalls.push(userId);
    if (h.unread instanceof Error) throw h.unread;
    return h.unread;
  },
}));
vi.mock("./_shell/session-actions", () => ({ logout: vi.fn() }));
vi.mock("./_shell/theme-actions", () => ({ chooseTheme: vi.fn(async () => undefined) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(h.search),
  // NetworkStatus оболочки (плашка «Нет связи», обновление при возврате) берёт роутер; в статическом рендере он не вызывается.
  useRouter: () => ({ refresh: vi.fn() }),
}));

/** Человек, прошедший первые шаги (согласие, ФИО и ИИН, почта); поля переопределяет тест. */
const done = (role: ShellUser["role"], over: Partial<ShellUser> = {}): ShellUser => ({
  role,
  roles: [role],
  fullName: role === "OPERATOR" ? null : "Айгерим",
  iinLast4: "1234",
  emailVerified: true,
  executor: null,
  mfa: { required: false, verifiedAt: null },
  consents: [{ version: consentDocument("PD_PROCESSING").version }],
  consentRevocationOpen: false,
  ...over,
});

const { default: AppLayout, generateViewport, metadata } = await import("./layout");

async function render(): Promise<string> {
  // Колокольчик телефона стоит в строке заголовка экрана (PageTitle): страница — заголовок и текст.
  return renderToStaticMarkup(
    await AppLayout({
      children: (
        <>
          <PageTitle title="Экран" />
          <p>page-body</p>
        </>
      ),
    }),
  );
}
const htmlTag = (out: string): string => {
  const at = out.indexOf("<html");
  return out.slice(at, out.indexOf(">", at) + 1);
};

beforeEach(() => {
  h.theme = "system";
  h.device = "mobile";
  h.shell = { user: null, unavailable: false };
  h.unread = 4;
  h.unreadCalls = [];
  h.pathname = "/v2/deals/7";
});

describe("корневой layout v2", () => {
  it("телефон: data-device=mobile, панель вкладок, без шапки", async () => {
    h.shell = { user: done("CLIENT"), unavailable: false };
    const out = await render();
    expect(htmlTag(out)).toContain('data-device="mobile"');
    expect(out).toContain("data-tab-bar");
    expect(out).not.toContain("data-top-bar");
    expect(out).toContain("page-body");
  });

  it("компьютер: data-device=desktop, шапка, без панели вкладок", async () => {
    h.device = "desktop";
    h.shell = { user: done("CLIENT"), unavailable: false };
    const out = await render();
    expect(htmlTag(out)).toContain('data-device="desktop"');
    expect(out).toContain("data-top-bar");
    expect(out).not.toContain("data-tab-bar");
  });

  it.each(["mobile", "desktop"] as const)("%s: пока не пройдены первые шаги — сосредоточенная оболочка, потом обычная", async (device) => {
    h.device = device;
    h.shell = { user: done("CLIENT", { consents: [], fullName: null, iinLast4: null, emailVerified: false }), unavailable: false };
    const focus = await render();
    expect(focus).toContain(ru.app.shell.logout);
    expect(focus).not.toContain("data-tab-bar");
    expect(focus).not.toContain(ru.app.shell.profileMenu);
    expect(focus).not.toMatch(/<nav/);
    expect(focus).toContain("page-body");

    h.shell = { user: done("CLIENT"), unavailable: false };
    const usual = await render();
    expect(usual).toMatch(/<nav/);
    expect(usual).not.toContain(ru.app.shell.logout);
    expect(usual).not.toContain("data-focus-bar");
  });

  it("гость: обычная оболочка, сосредоточенной нет", async () => {
    h.shell = { user: null, unavailable: false };
    const out = await render();
    expect(out).toContain("data-tab-bar");
    expect(out).not.toContain("data-focus-bar");
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
    h.shell = { user: done("OPERATOR", { consents: [], emailVerified: false, mfa: { required: true, verifiedAt: new Date() } }), unavailable: false };
    const out = await render();
    expect(out).not.toContain("page-body");
    expect(out).toContain(ru.app.shell.movingTitle);
    expect(out).toContain('href="/deals/7?tab=docs"');
    expect(out).toContain("data-top-bar");
  });
});

describe("счётчик уведомлений", () => {
  it("компьютер: колокольчик в шапке с числом; запрос один", async () => {
    h.device = "desktop";
    h.shell = { user: done("CLIENT"), unavailable: false };
    const out = await render();
    expect(out).toContain(`${ru.app.shell.notifications}, 4 непрочитанных`);
    expect(h.unreadCalls).toHaveLength(1);
  });

  it("телефон: на корневом экране вкладки — колокольчик в строке заголовка, на вложенном — нет", async () => {
    h.shell = { user: done("CLIENT"), unavailable: false };
    h.pathname = "/v2/deals";
    expect(await render()).toContain(`${ru.app.shell.notifications}, 4 непрочитанных`);
    h.pathname = "/v2/deals/7";
    expect(await render()).not.toContain('href="/v2/notifications"');
  });

  it.each(["mobile", "desktop"] as const)("%s: гостю и в сосредоточенной оболочке колокольчика нет и запроса нет", async (device) => {
    h.device = device;
    h.pathname = "/v2";
    h.shell = { user: null, unavailable: false };
    expect(await render()).not.toContain("/v2/notifications");
    h.shell = { user: done("CLIENT", { consents: [], fullName: null, iinLast4: null, emailVerified: false }), unavailable: false };
    expect(await render()).not.toContain("/v2/notifications");
    expect(h.unreadCalls).toEqual([]);
  });

  it.each(["mobile", "desktop"] as const)("%s: сбой чтения счётчика не роняет оболочку — колокольчик без числа", async (device) => {
    h.device = device;
    h.pathname = "/v2";
    h.shell = { user: done("CLIENT"), unavailable: false };
    h.unread = new Error("база недоступна");
    const out = await render();
    expect(out).toContain("page-body");
    expect(out).toContain('href="/v2/notifications"');
    expect(out).not.toContain("непрочитанных");
  });
});

describe("metadata", () => {
  it("временные страницы v2 не индексируются (до переключения на этапе 6)", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("generateViewport: цвет строки состояния по теме", () => {
  it("«Авто» — пара для светлой и тёмной", async () => {
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
