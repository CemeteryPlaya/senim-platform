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
vi.mock("./theme-actions", () => ({ setTheme: vi.fn(async () => ({ ok: true, data: undefined })), chooseTheme: vi.fn(async () => undefined) }));

const { DesktopShell } = await import("./DesktopShell");
const { MobileShell } = await import("./MobileShell");
const { ThemeSwitch } = await import("./ThemeSwitch");
const { MovingPlaceholder } = await import("./Moving");
const { navFor } = await import("./nav");

const OFF = { preContractFlows: false, inspiration: false, materialsCalculator: false };
const clientNav = navFor({ role: "CLIENT", executor: null }, OFF);
const guestNav = navFor(null, OFF);
const focusNav = navFor({ role: "CLIENT", executor: null }, OFF, { focus: true });
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

  it("main без дока обычный блок: flex-колонкой его делает только утилита dock-column, и только при доке внутри", () => {
    for (const nav of [clientNav, { ...clientNav, tabs: [] }]) {
      const main = tagWith(html(<MobileShell nav={nav}>x</MobileShell>), `id="content"`);
      expect(hasClass(main, "dock-column")).toBe(true);
      for (const cls of ["flex", "flex-col"]) expect(hasClass(main, cls), cls).toBe(false);
      expect(main).not.toContain("min-w-0");
      expect(hasClass(main, "flex-1")).toBe(true);
    }
  });

  it("под плавающими панелями — подложка цвета фона (bar-underlay), без кликов и вне доступности; без вкладок её нет", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const underlay = tagWith(m, "data-bar-underlay");
    expect(hasClass(underlay, "bar-underlay")).toBe(true);
    expect(underlay).toContain("aria-hidden");
    expect(m.indexOf("data-bar-underlay")).toBeLessThan(m.indexOf("data-tab-bar"));
    expect(html(<MobileShell nav={{ ...clientNav, tabs: [] }}>x</MobileShell>)).not.toContain("data-bar-underlay");
  });

  it("панель плавающая и полупрозрачная: glass, rounded-bar, shadow-float, прилипает снизу с отступом", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const bar = tagWith(m, "data-tab-bar");
    for (const cls of ["glass", "rounded-bar", "shadow-float"]) expect(hasClass(bar, cls), cls).toBe(true);
    const navTag = tagWith(m, 'aria-label="Основное меню"');
    for (const cls of ["sticky", "dock-bottom", "dock-inline"]) expect(hasClass(navTag, cls), cls).toBe(true);
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

  it("гость на главной: «Главная» — текущая вкладка (ink, 600), остальные muted (500)", () => {
    // Причина пустого выделения на первых снимках: у гостя не было вкладки, совпадающей с /v2 (и с /v2/ui-kit).
    nav.pathname = "/v2";
    const m = html(<MobileShell nav={guestNav}>x</MobileShell>);
    const links = m.match(/<a [^>]*>[\s\S]*?<\/a>/g)?.filter((a) => a.includes("data-tab-label")) ?? [];
    expect(links).toHaveLength(4);
    const current = links.filter((a) => a.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/v2"');
    expect(hasClass(current[0], "text-ink")).toBe(true);
    expect(hasClass(tagWith(current[0], "data-tab-label"), "font-semibold")).toBe(true);
    for (const other of links.filter((a) => !a.includes('aria-current="page"'))) {
      expect(hasClass(other, "text-muted")).toBe(true);
      expect(hasClass(tagWith(other, "data-tab-label"), "font-medium")).toBe(true);
    }
  });

  it("гость: «Войти» — последняя вкладка", () => {
    const m = html(<MobileShell nav={guestNav}>x</MobileShell>);
    const hrefs = anchors(m)
      .filter((a) => !a.includes('href="#content"'))
      .map((a) => /href="([^"]+)"/.exec(a)?.[1]);
    expect(hrefs).toEqual(["/v2", "/v2/catalog", "/v2/about", "/v2/login"]);
  });

  it("содержимое — колонка до 560 px по центру", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const main = tagWith(m, 'id="content"');
    expect(main.startsWith("<main")).toBe(true);
    for (const cls of ["max-w-column", "mx-auto"]) expect(hasClass(main, cls), cls).toBe(true);
  });

  it("поля содержимого не заходят в безопасные зоны (вырез, полоска «домой»)", () => {
    const main = tagWith(html(<MobileShell nav={clientNav}>x</MobileShell>), 'id="content"');
    for (const cls of ["safe-gutter", "safe-block"]) expect(hasClass(main, cls), cls).toBe(true);
    // Обычные отступы перебили бы утилиты безопасной зоны.
    expect(main).not.toMatch(/class="(?:[^"]*\s)?(?:p|px|py|pt|pb|pl|pr)-\d/);
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
    const inner = d.slice(d.indexOf("data-top-bar")).match(/<div [^>]*>/)?.[0] ?? "";
    for (const cls of ["min-h-header", "max-w-content"]) expect(hasClass(inner, cls), cls).toBe(true);
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

  it("гость: в разделах Мастера · О сервисе; «Войти» — справа кнопкой secondary, не в ряду разделов", () => {
    const d = html(
      <DesktopShell nav={guestNav} user={null}>
        x
      </DesktopShell>,
    );
    const navBlock = d.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(anchors(navBlock).map((a) => /href="([^"]+)"/.exec(a)?.[1])).toEqual(["/v2/catalog", "/v2/about"]);
    expect(navBlock).not.toContain("/v2/login");
    const login = tagWith(d, 'href="/v2/login"');
    expect(d.indexOf('href="/v2/login"')).toBeGreaterThan(d.indexOf("</nav>"));
    expect(login).not.toContain("data-primary-action");
    expect(hasClass(login, "bg-line")).toBe(true); // вид secondary
    expect(d).toContain(`>${ru.app.shell.nav.login}</a>`);
    expect(d).not.toContain("/v2/notifications");
    expect(d).not.toContain(ru.app.shell.profileMenu);
  });

  it("гость: текущий раздел — ink и вес 600, остальные — muted и 500", () => {
    nav.pathname = "/v2/catalog/3";
    const d = html(
      <DesktopShell nav={guestNav} user={null}>
        x
      </DesktopShell>,
    );
    const navBlock = d.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    const [masters, about] = anchors(navBlock);
    expect(masters).toContain('aria-current="page"');
    for (const cls of ["text-ink", "font-semibold"]) expect(hasClass(masters, cls), cls).toBe(true);
    expect(about).not.toContain("aria-current");
    for (const cls of ["text-muted", "font-medium"]) expect(hasClass(about, cls), cls).toBe(true);
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
    // role="alert": плашка приходит в разметке сервера, а role="status" при первой отрисовке диктор не читает.
    const alert = out.match(/<div [^>]*role="alert"[^>]*>([^<]*)<\/div>/);
    expect(alert?.[1]).toBe(ru.common.errors.unavailable);
    expect(out).not.toContain('role="status"');
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

  it("сегментированный переключатель: дорожка track, три равных сегмента в одну строку, выбранный приподнят (raised)", () => {
    const out = html(<ThemeSwitch current="light" />);
    const track = out.match(/<div [^>]*>/)?.[0] ?? "";
    for (const cls of ["grid", "grid-flow-col", "auto-cols-fr", "bg-track", "rounded-control", "p-1"]) {
      expect(hasClass(track, cls), cls).toBe(true);
    }
    expect(track).not.toContain("flex-wrap");
    const buttons = out.match(/<button [^>]*>/g) ?? [];
    for (const b of buttons) {
      for (const cls of ["aria-pressed:bg-raised", "aria-pressed:font-semibold", "text-ink", "min-h-control", "desktop:min-h-control-sm"]) {
        expect(hasClass(b, cls), cls).toBe(true);
      }
      expect(b).not.toMatch(/shadow|bg-surface/);
    }
  });

  it("подпись «как в системе» — короткая «Авто»: сегмент выдерживает крупный шрифт", () => {
    expect(ru.app.shell.theme.system).toBe("Авто");
    expect(html(<ThemeSwitch current="system" />)).toContain(">Авто</button>");
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

describe("сосредоточенная оболочка (первые шаги после входа)", () => {
  const brand = ru.common.brand;

  it("телефон: узкая шапка — название-ссылка на главную и «Выйти»; панели вкладок и подложки нет", () => {
    const m = html(<MobileShell nav={focusNav}>x</MobileShell>);
    expect(m).toContain("data-focus-bar");
    // Название — текст, а не ссылка на главную: со шага уходить некуда.
    expect(m).toContain(brand);
    expect(m).not.toContain('href="/v2"');
    expect(m).toContain(ru.app.shell.logout);
    // Отступ выреза — у шапки (safe-bar), main под ней верх не добавляет (safe-block только у обычной оболочки).
    expect(hasClass(tagWith(m, "data-focus-bar"), "safe-bar")).toBe(true);
    const main = tagWith(m, 'id="content"');
    expect(hasClass(main, "safe-block")).toBe(false);
    for (const cls of ["safe-gutter", "safe-bottom", "pt-6"]) expect(hasClass(main, cls), cls).toBe(true);
    expect(m).not.toContain("data-tab-bar");
    expect(m).not.toContain("data-bar-underlay");
    expect(m).not.toContain("data-has-tabs");
    expect(m).not.toMatch(/<nav/);
    for (const href of ["/v2/requests", "/v2/deals", "/v2/chats", "/v2/profile"]) expect(m).not.toContain(`href="${href}"`);
  });

  it("компьютер: шапка с названием слева и «Выйти» справа вторичной кнопкой; ни разделов, ни «Новая заявка», ни колокольчика, ни аватара", () => {
    const d = html(
      <DesktopShell nav={focusNav} user={client}>
        x
      </DesktopShell>,
    );
    expect(d).toContain(brand);
    expect(d).not.toContain('href="/v2"');
    const logoutClass = new RegExp(`<button[^>]*class="([^"]*)"[^>]*>(?:<span[^>]*>)?${ru.app.shell.logout}`).exec(d)?.[1] ?? "";
    expect(hasClass(`class="${logoutClass}"`, "bg-line")).toBe(true);
    expect(d).not.toMatch(/<nav/);
    expect(d).not.toContain(ru.app.shell.newRequest);
    expect(d).not.toContain(ru.app.shell.notifications);
    expect(d).not.toContain(ru.app.shell.profileMenu);
    expect(d).not.toContain("data-primary-action");
  });

  it("гость и человек с пройденным онбордингом видят прежнюю оболочку", () => {
    const g = html(<MobileShell nav={guestNav}>x</MobileShell>);
    expect(g).toContain("data-tab-bar");
    expect(g).not.toContain("data-focus-bar");
    // Обычная оболочка: вырез учитывает main (safe-block), название — ссылка на главную.
    expect(hasClass(tagWith(g, 'id="content"'), "safe-block")).toBe(true);
    const c = html(
      <DesktopShell nav={clientNav} user={client}>
        x
      </DesktopShell>,
    );
    expect(c).toMatch(/<nav/);
    expect(c).toMatch(new RegExp(`<a [^>]*href="/v2"[^>]*>${brand}</a>`));
    expect(c).toContain(ru.app.shell.newRequest);
    expect(c).toContain(ru.app.shell.profileMenu);
    expect(c).not.toContain(ru.app.shell.logout);
  });
});
