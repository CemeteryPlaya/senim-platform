import { beforeEach, describe, expect, it, vi } from "vitest";
import { count, hasClass, html } from "@/kit/test-utils";
import { ru } from "@/i18n/ru";

const nav = vi.hoisted(() => ({ pathname: null as string | null }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => nav.pathname,
}));
// Действия сервера в статическом рендере не вызываются; модуль identity тянет базу — заменяем.
vi.mock("./session-actions", () => ({ logout: vi.fn() }));
vi.mock("./theme-actions", () => ({ setTheme: vi.fn(async () => undefined) }));

const { DesktopShell } = await import("./DesktopShell");
const { MobileShell } = await import("./MobileShell");
const { ThemeSwitch } = await import("./ThemeSwitch");
const { MovingPlaceholder } = await import("./Moving");
const { navFor } = await import("./nav");

const OFF = { preContractFlows: false, inspiration: false, materialsCalculator: false };
const clientNav = navFor({ role: "CLIENT", executor: null }, OFF);
const guestNav = navFor(null, OFF);
const operatorNav = navFor({ role: "OPERATOR", executor: null }, OFF);
const client = { fullName: "Айгерим Сапарова" };

/** Открывающий тег первого элемента, у которого есть атрибут `attr`. */
const tagWith = (out: string, attr: string): string => {
  const at = out.indexOf(attr);
  if (at < 0) throw new Error(`нет ${attr}`);
  return out.slice(out.lastIndexOf("<", at), out.indexOf(">", at) + 1);
};
const anchors = (out: string): string[] => out.match(/<a [^>]*>/g) ?? [];

beforeEach(() => {
  nav.pathname = null;
});

it("самопроверка hasClass: только целое слово, в любом месте списка", () => {
  expect(hasClass('<p class="glass b">', "glass")).toBe(true);
  expect(hasClass('<p class="a glass">', "glass")).toBe(true);
  expect(hasClass('<p class="a glass-x">', "glass")).toBe(false);
  expect(hasClass('<p class="max-w-content">', "w-content")).toBe(false);
  expect(hasClass('<p class="min-h-control-sm">', "min-h-control")).toBe(false);
  expect(hasClass('<p class="py-1.5">', "py-1")).toBe(false);
});

describe("MobileShell", () => {
  it("панель вкладок — nav «Основное меню» со ссылками на все вкладки", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    expect(m).toMatch(/<nav[^>]+aria-label="Основное меню"/);
    expect(count(m, "<a ")).toBeGreaterThanOrEqual(5);
    for (const href of ["/v2", "/v2/requests", "/v2/deals", "/v2/chats", "/v2/profile"]) {
      expect(m).toContain(`href="${href}"`);
    }
  });

  it("панель плавающая и полупрозрачная: glass, rounded-bar, shadow-float, прилипает снизу с отступом", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const bar = tagWith(m, "data-tab-bar");
    for (const cls of ["glass", "rounded-bar", "shadow-float"]) expect(hasClass(bar, cls), cls).toBe(true);
    const navTag = tagWith(m, 'aria-label="Основное меню"');
    for (const cls of ["sticky", "dock-bottom", "px-bar-inset"]) expect(hasClass(navTag, cls), cls).toBe(true);
  });

  it("подпись вкладки — 13 px и не обрезается", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const label = tagWith(m, "data-tab-label");
    expect(hasClass(label, "text-small")).toBe(true);
    expect(label).not.toMatch(/truncate|line-clamp|overflow-hidden|whitespace-nowrap/);
  });

  it("активная вкладка — aria-current=page и цвет ink, остальные — muted", () => {
    nav.pathname = "/v2/deals/42";
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const current = anchors(m).filter((a) => a.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/v2/deals"');
    expect(hasClass(current[0], "text-ink")).toBe(true);
    const home = anchors(m).find((a) => a.includes('href="/v2"'));
    expect(home).toBeDefined();
    expect(hasClass(home ?? "", "text-muted")).toBe(true);
  });

  it("содержимое — колонка до 560 px по центру", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const main = tagWith(m, 'id="content"');
    expect(main.startsWith("<main")).toBe(true);
    for (const cls of ["max-w-column", "mx-auto"]) expect(hasClass(main, cls), cls).toBe(true);
  });

  it("у роли без вкладок (оператор) панели нет", () => {
    const m = html(<MobileShell nav={operatorNav}>x</MobileShell>);
    expect(m).not.toContain("<nav");
    expect(m).toContain('id="content"');
  });
});

describe("DesktopShell", () => {
  it("главное действие роли — в шапке, но не главная кнопка экрана", () => {
    const d = html(
      <DesktopShell nav={clientNav} user={client}>
        x
      </DesktopShell>,
    );
    expect(d).toContain('href="/v2/requests/new"');
    expect(d).not.toContain("data-primary-action"); // кнопка шапки — secondary: главное действие принадлежит экрану
  });

  it("шапка прилипает, полупрозрачная, высота 52 px; разделы — в nav «Основное меню»", () => {
    const d = html(
      <DesktopShell nav={clientNav} user={client}>
        x
      </DesktopShell>,
    );
    const header = tagWith(d, "data-top-bar");
    expect(header.startsWith("<header")).toBe(true);
    for (const cls of ["glass", "sticky", "top-0", "border-b", "border-line"]) expect(hasClass(header, cls), cls).toBe(true);
    expect(d).toMatch(/class="[^"]*\bmin-h-header\b/);
    expect(d).toMatch(/<nav[^>]+aria-label="Основное меню"/);
    for (const href of ["/v2", "/v2/requests", "/v2/deals", "/v2/chats", "/v2/profile"]) expect(d).toContain(`href="${href}"`);
  });

  it("название продукта ведёт на главную, колокольчик — на уведомления, аватар открывает меню", () => {
    const d = html(
      <DesktopShell nav={clientNav} user={client}>
        x
      </DesktopShell>,
    );
    expect(d).toContain(`>${ru.common.brand}</a>`);
    const bell = tagWith(d, 'href="/v2/notifications"');
    expect(bell).toContain(`aria-label="${ru.app.shell.notifications}"`);
    const avatar = tagWith(d, `aria-label="${ru.app.shell.profileMenu}"`);
    expect(avatar).toContain('aria-haspopup="menu"');
    expect(d).toContain(">АС<"); // инициалы
  });

  it("содержимое — по центру, до 1100 px", () => {
    const d = html(
      <DesktopShell nav={clientNav} user={client}>
        x
      </DesktopShell>,
    );
    const main = tagWith(d, 'id="content"');
    for (const cls of ["max-w-content", "mx-auto"]) expect(hasClass(main, cls), cls).toBe(true);
  });

  it("гость: разделы и «Войти» в строке, без колокольчика и аватара", () => {
    const d = html(
      <DesktopShell nav={guestNav} user={null}>
        x
      </DesktopShell>,
    );
    for (const href of ["/v2/catalog", "/v2/about", "/v2/login"]) expect(d).toContain(`href="${href}"`);
    expect(d).not.toContain("/v2/notifications");
    expect(d).not.toContain(ru.app.shell.profileMenu);
  });

  it("оператор: шапка с названием и меню профиля, без разделов", () => {
    const d = html(
      <DesktopShell nav={operatorNav} user={{ fullName: null }}>
        x
      </DesktopShell>,
    );
    expect(d).toContain("data-top-bar");
    expect(d).not.toContain("<nav");
    expect(d).toContain(ru.app.shell.profileMenu);
  });

  it("активный раздел — aria-current=page", () => {
    nav.pathname = "/v2/requests/7";
    const d = html(
      <DesktopShell nav={clientNav} user={client}>
        x
      </DesktopShell>,
    );
    const current = anchors(d).filter((a) => a.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/v2/requests"');
  });
});

describe.each([
  ["MobileShell", (unavailable?: boolean) => <MobileShell nav={clientNav} unavailable={unavailable}>x</MobileShell>],
  [
    "DesktopShell",
    (unavailable?: boolean) => (
      <DesktopShell nav={clientNav} user={client} unavailable={unavailable}>
        x
      </DesktopShell>
    ),
  ],
])("%s: общее", (_name, render) => {
  it("первая ссылка — «Перейти к содержимому» на main#content", () => {
    const out = html(render());
    const first = anchors(out)[0];
    expect(first).toContain('href="#content"');
    expect(out).toContain(`>${ru.app.shell.skipLink}</a>`);
    expect(out.indexOf(ru.app.shell.skipLink)).toBeLessThan(out.indexOf("<main"));
  });

  it("main с id и tabIndex=-1, содержимое внутри", () => {
    const out = html(render());
    expect(out).toMatch(/<main[^>]*id="content"[^>]*tabindex="-1"|<main[^>]*tabindex="-1"[^>]*id="content"/);
    expect(out).toMatch(/<main[^>]*>[\s\S]*x[\s\S]*<\/main>/);
  });

  it("при недоступности identity — предупреждение, которое озвучивается", () => {
    expect(html(render())).not.toContain(ru.common.errors.unavailable);
    const out = html(render(true));
    expect(out).toContain(ru.common.errors.unavailable);
    expect(tagWith(out, 'role="status"')).toBeTruthy();
  });
});

describe("ThemeSwitch", () => {
  it("три варианта, выбранный — aria-pressed=true; отправка формой", () => {
    const out = html(<ThemeSwitch current="dark" />);
    const t = ru.app.shell.theme;
    for (const label of [t.system, t.light, t.dark]) expect(out).toContain(label);
    expect(out).toContain(`<legend`);
    const buttons = out.match(/<button [^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b).toContain('type="submit"');
    const pressed = buttons.filter((b) => b.includes('aria-pressed="true"'));
    expect(pressed).toHaveLength(1);
    expect(out.indexOf('aria-pressed="true"')).toBeGreaterThan(out.indexOf(t.light));
    expect(out).not.toContain("data-primary-action");
    expect(out).toMatch(/<form/);
  });
});

describe("MovingPlaceholder", () => {
  it("заглушка: один заголовок и ссылка на тот же адрес в v1", () => {
    const out = html(<MovingPlaceholder href="/deals/1?tab=2" />);
    expect(count(out, "<h1")).toBe(1);
    expect(out).toContain(ru.app.shell.movingTitle);
    expect(out).toContain(ru.app.shell.movingBody);
    expect(out).toMatch(/<a [^>]*href="\/deals\/1\?tab=2"[^>]*>[\s\S]*Открыть раздел/);
  });
});
