import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageTitle } from "@/kit";
import { count, hasClass, html } from "@/kit/test-utils";
import { ru } from "@/i18n/ru";

const nav = vi.hoisted(() => ({ pathname: null as string | null }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => nav.pathname,
  // NetworkStatus (плашка «Нет связи», обновление при возврате) берёт роутер; в статическом рендере он не вызывается.
  useRouter: () => ({ refresh: vi.fn() }),
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

  it("под плавающими панелями — растворение (bar-underlay), без кликов и вне доступности; видимость — по вкладкам или доку (CSS)", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const underlay = tagWith(m, "data-bar-underlay");
    expect(hasClass(underlay, "bar-underlay")).toBe(true);
    expect(underlay).toContain("aria-hidden");
    expect(m.indexOf("data-bar-underlay")).toBeLessThan(m.indexOf("data-tab-bar"));
    // Без вкладок подложка в разметке есть (у экрана может быть док), а видна только при доке: правило bar-underlay.
    const noTabs = html(<MobileShell nav={{ ...clientNav, tabs: [] }}>x</MobileShell>);
    expect(hasClass(tagWith(noTabs, "data-bar-underlay"), "bar-underlay")).toBe(true);
  });

  it("панель плавающая, стекло: glass-regular (кромка, контур и тень в материале), капсула, прилипает снизу с отступом", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const bar = tagWith(m, "data-tab-bar");
    for (const cls of ["glass-regular", "rounded-bar"]) expect(hasClass(bar, cls), cls).toBe(true);
    // Серой рамки и отдельной тени нет: контур 0,5 px и тень float даёт сам материал.
    for (const cls of ["border", "border-line", "shadow-float"]) expect(hasClass(bar, cls), cls).toBe(false);
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
    // На стекле вторичный текст — glass-secondary (обычный muted на стекле над тёмным фото ниже 4,5:1).
    expect(hasClass(home ?? "", "text-glass-secondary")).toBe(true);
  });

  it("активная вкладка — линза: подложка fill-strong за иконкой и подписью (не толщина штриха), скрыта от диктора", () => {
    nav.pathname = "/v2/deals/42";
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const links = m.match(/<a [^>]*>[\s\S]*?<\/a>/g)?.filter((a) => a.includes("data-tab-label")) ?? [];
    const withLens = links.filter((a) => a.includes("data-nav-lens"));
    expect(withLens).toHaveLength(1);
    expect(withLens[0]).toContain('aria-current="page"');
    const lens = tagWith(withLens[0], "data-nav-lens");
    for (const cls of ["bg-fill-strong", "rounded-chip", "absolute", "-z-10"]) expect(hasClass(lens, cls), cls).toBe(true);
    expect(lens).toContain('aria-hidden="true"');
    // Иконки одной толщины: выбранную отличает линза.
    expect(new Set(links.map((a) => /stroke-width="([\d.]+)"/.exec(a)?.[1])).size).toBe(1);
  });

  it("«Сделки» — значок документа с отметкой, а не рукопожатие", () => {
    const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
    const deals = anchors(m).find((a) => a.includes('href="/v2/deals"')) ?? "";
    expect(m).not.toContain("lucide-handshake");
    expect(m.slice(m.indexOf('href="/v2/deals"'), m.indexOf('href="/v2/deals"') + 800)).toMatch(/lucide-file-check/);
    expect(deals).toBeTruthy();
  });

  it("гость на главной: «Главная» — текущая вкладка (ink, 600), остальные glass-secondary (500)", () => {
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
      expect(hasClass(other, "text-glass-secondary")).toBe(true);
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

  it("у роли без вкладок (оператор) панели нет: разделы — шторкой «Меню» из шапки (закрыта — меню в разметке нет)", () => {
    const m = html(<MobileShell nav={operatorNav}>x</MobileShell>);
    expect(m).not.toContain("<nav");
    expect(m).not.toContain("data-tab-bar");
    expect(m).toContain("data-operator-bar");
    expect(m).toContain('aria-haspopup="dialog"');
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

  it("шапка прилипает, стекло во всю ширину без линии (glass-bar), высота 52 px; разделы — в nav «Основное меню»", () => {
    const d = html(
      <DesktopShell nav={clientNav} user={client}>
        x
      </DesktopShell>,
    );
    const header = tagWith(d, "data-top-bar");
    expect(header.startsWith("<header")).toBe(true);
    for (const cls of ["glass-bar", "sticky", "top-0"]) expect(hasClass(header, cls), cls).toBe(true);
    for (const cls of ["border-b", "border-line"]) expect(hasClass(header, cls), cls).toBe(false);
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
    // Название продукта у вошедшего — лендинг (как до входа), «Главная» в меню — его дом.
    expect(d).toMatch(new RegExp(`<a [^>]*href="/v2/landing"[^>]*>${ru.common.brand}</a>`));
    expect(d).toMatch(/<nav[\s\S]*href="\/v2"/);
    const g = html(<DesktopShell nav={guestNav} user={null}>x</DesktopShell>);
    expect(g).toMatch(new RegExp(`<a [^>]*href="/v2"[^>]*>${ru.common.brand}</a>`));
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

  it("гость: в разделах Мастера · О сервисе; «Войти» — справа тихой кнопкой со значком, не в ряду разделов", () => {
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
    // Тихая (без заливки): заливка-капсула в шапке — только линза раздела.
    expect(hasClass(login, "bg-transparent")).toBe(true);
    expect(hasClass(login, "bg-fill")).toBe(false);
    expect(d.slice(d.indexOf('href="/v2/login"'))).toMatch(/^[^>]*>\s*<svg[^>]*lucide-log-in/);
    expect(d).toContain(`>${ru.app.shell.nav.login}</a>`);
    expect(d).not.toContain("/v2/notifications");
    expect(d).not.toContain(ru.app.shell.profileMenu);
  });

  it("гость на экранах входа: «Войти» в шапке компьютера нет, на телефоне вкладка «Войти» активна", () => {
    for (const path of ["/v2/login", "/v2/login?step=phone"]) {
      nav.pathname = path.split("?")[0];
      const d = html(
        <DesktopShell nav={guestNav} user={null}>
          x
        </DesktopShell>,
      );
      expect(d).not.toContain('href="/v2/login"');
      expect(d).toContain('href="/v2/catalog"');
    }
    nav.pathname = "/v2/login";
    const m = html(<MobileShell nav={guestNav}>x</MobileShell>);
    expect(tagWith(m, 'href="/v2/login"')).toContain('aria-current="page"');
  });

  it("текущий раздел в шапке — с линзой (подложка за подписью), остальные без неё", () => {
    nav.pathname = "/v2/catalog/3";
    const d = html(
      <DesktopShell nav={guestNav} user={null}>
        x
      </DesktopShell>,
    );
    const navBlock = d.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    const links = navBlock.match(/<a [^>]*>[\s\S]*?<\/a>/g) ?? [];
    expect(links.filter((a) => a.includes("data-nav-lens"))).toHaveLength(1);
    expect(links.find((a) => a.includes("data-nav-lens"))).toContain('aria-current="page"');
  });

  it("«Заказать мебель» — тихая кнопка ink со значком «+», не заливка-капсула (её носит только линза раздела)", () => {
    const d = html(
      <DesktopShell nav={clientNav} user={client}>
        x
      </DesktopShell>,
    );
    const order = tagWith(d, 'href="/v2/requests/new"');
    for (const cls of ["bg-transparent", "text-ink"]) expect(hasClass(order, cls), cls).toBe(true);
    expect(hasClass(order, "bg-fill")).toBe(false);
    expect(d.slice(d.indexOf('href="/v2/requests/new"'))).toMatch(/^[^>]*>\s*<svg[^>]*lucide-plus/);
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
    for (const cls of ["text-glass-secondary", "font-medium"]) expect(hasClass(about, cls), cls).toBe(true);
  });

  it("оператор: шапка с названием и меню профиля без разделов; разделы — меню слева по группам", () => {
    const d = html(
      <DesktopShell nav={operatorNav} user={{ fullName: null }}>
        x
      </DesktopShell>,
    );
    expect(d).toContain("data-top-bar");
    expect(d).not.toContain(`aria-label="${ru.app.shell.navLabel}"`);
    expect(d).toContain(ru.app.shell.profileMenu);
    const navs = d.match(/<nav[^>]*>/g) ?? [];
    expect(navs).toEqual([expect.stringContaining(`aria-label="${ru.app.operator.navLabel}"`)]);
    // Меню стоит в разметке до содержимого и прилипает под шапкой.
    expect(d.indexOf("<nav")).toBeLessThan(d.indexOf('id="content"'));
    expect(d).toContain("sticky-nav");
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

  it("legendHidden: подпись группы остаётся для диктора (sr-only), видимой нет", () => {
    const hidden = html(<ThemeSwitch current="dark" legend="Цветовая тема" legendHidden />);
    expect(hidden).toContain('<legend class="sr-only">Цветовая тема</legend>');
    expect(html(<ThemeSwitch current="dark" legend="Цветовая тема" />)).not.toContain('<legend class="sr-only"');
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
    expect(m).not.toContain("data-has-tabs");
    expect(m).not.toMatch(/<nav/);
    for (const href of ["/v2/requests", "/v2/deals", "/v2/chats", "/v2/profile"]) expect(m).not.toContain(`href="${href}"`);
  });

  it("компьютер: шапка с названием слева и «Выйти» справа вторичной кнопкой; ни разделов, ни «Заказать мебель», ни колокольчика, ни аватара", () => {
    const d = html(
      <DesktopShell nav={focusNav} user={client}>
        x
      </DesktopShell>,
    );
    expect(d).toContain(brand);
    expect(d).not.toContain('href="/v2"');
    const logoutClass = new RegExp(`<button[^>]*class="([^"]*)"[^>]*>(?:<span[^>]*>)?${ru.app.shell.logout}`).exec(d)?.[1] ?? "";
    expect(hasClass(`class="${logoutClass}"`, "bg-fill")).toBe(true);
    expect(d).not.toMatch(/<nav/);
    expect(d).not.toContain(ru.app.shell.order);
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
    expect(c).toMatch(new RegExp(`<a [^>]*href="/v2/landing"[^>]*>${brand}</a>`));
    expect(c).toContain(ru.app.shell.order);
    expect(c).toContain(ru.app.shell.profileMenu);
    expect(c).not.toContain(ru.app.shell.logout);
  });
});

describe("колокольчик: компьютер", () => {
  it("с непрочитанными: бейдж в ссылке, доступное имя — «Уведомления, N непрочитанных»", () => {
    const d = html(
      <DesktopShell nav={clientNav} user={client} unread={3}>
        x
      </DesktopShell>,
    );
    const bell = tagWith(d, 'href="/v2/notifications"');
    expect(bell).toContain(`aria-label="${ru.app.shell.notifications}, 3 непрочитанных"`);
    const link = d.match(/<a [^>]*href="\/v2\/notifications"[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(link).toMatch(/<span aria-hidden="true"[^>]*>3<\/span>/);
  });

  it("без непрочитанных: бейджа нет, имя — «Уведомления»; больше 99 — «99+»", () => {
    const none = html(
      <DesktopShell nav={clientNav} user={client} unread={0}>
        x
      </DesktopShell>,
    );
    expect(tagWith(none, 'href="/v2/notifications"')).toContain(`aria-label="${ru.app.shell.notifications}"`);
    expect(none.match(/<a [^>]*href="\/v2\/notifications"[\s\S]*?<\/a>/)?.[0]).not.toMatch(/<span aria-hidden="true"/);
    const many = html(
      <DesktopShell nav={clientNav} user={client} unread={250}>
        x
      </DesktopShell>,
    );
    expect(many).toContain(">99+<");
  });
});

describe("TitleBell: колокольчик в строке заголовка корневых экранов вкладок", () => {
  const page = (
    <>
      <PageTitle title="Сделки" />
      <p>x</p>
    </>
  );
  /** Строка заголовка: от `<h1` до конца шапки экрана. */
  const titleRow = (m: string) => m.slice(m.indexOf("<h1"), m.indexOf("</header>"));

  it.each(["/v2", "/v2/requests", "/v2/deals", "/v2/chats", "/v2/profile"])("%s: колокольчик справа от h1, отдельной строки нет", (path) => {
    nav.pathname = path;
    const m = html(<MobileShell nav={clientNav} unread={2}>{page}</MobileShell>);
    const row = titleRow(m);
    expect(row).toContain('href="/v2/notifications"');
    expect(row).toContain(`${ru.app.shell.notifications}, 2 непрочитанных`);
    expect(count(m, 'href="/v2/notifications"')).toBe(1);
    // Колокольчик — внутри шапки экрана, после заголовка, а не строкой над ним.
    expect(m.indexOf('href="/v2/notifications"')).toBeGreaterThan(m.indexOf("<h1"));
  });

  it.each(["/v2/deals/7", "/v2/requests/new", "/v2/profile/data", "/v2/notifications", null])("%s: на вложенном экране и без адреса колокольчика нет", (path) => {
    nav.pathname = path;
    expect(html(<MobileShell nav={clientNav} unread={2}>{page}</MobileShell>)).not.toContain('href="/v2/notifications"');
  });

  it("гость и сосредоточенная оболочка: колокольчика нет", () => {
    nav.pathname = "/v2";
    expect(html(<MobileShell nav={guestNav}>{page}</MobileShell>)).not.toContain('href="/v2/notifications"');
    expect(html(<MobileShell nav={guestNav} unread={0}>{page}</MobileShell>)).not.toContain('href="/v2/notifications"');
    expect(html(<MobileShell nav={focusNav} unread={0}>{page}</MobileShell>)).not.toContain('href="/v2/notifications"');
    expect(html(<MobileShell nav={clientNav}>{page}</MobileShell>)).not.toContain('href="/v2/notifications"');
  });

  it("колокольчик — круглая кнопка 48 px без стекла: на телефоне строка заголовка в покое не плавает, в шапке компьютера шапка уже стекло", () => {
    nav.pathname = "/v2";
    const bell = tagWith(html(<MobileShell nav={clientNav} unread={2}>{page}</MobileShell>), 'href="/v2/notifications"');
    for (const cls of ["rounded-full", "size-control", "hover:bg-fill"]) expect(hasClass(bell, cls), cls).toBe(true);
    expect(hasClass(bell, "glass-regular")).toBe(false);
    const d = html(
      <DesktopShell nav={clientNav} user={client} unread={2}>
        x
      </DesktopShell>,
    );
    const deskBell = tagWith(d, 'href="/v2/notifications"');
    expect(hasClass(deskBell, "glass-regular")).toBe(false);
    expect(hasClass(deskBell, "hover:bg-fill")).toBe(true);
  });

  it("без непрочитанных колокольчик есть, бейджа нет", () => {
    nav.pathname = "/v2";
    const m = html(<MobileShell nav={clientNav} unread={0}>{page}</MobileShell>);
    expect(m).toContain('href="/v2/notifications"');
    expect(m).not.toMatch(/<span aria-hidden="true"[^>]*>0<\/span>/);
  });
});

describe("ThemeSwitch: своя подпись группы", () => {
  it("legend задаётся снаружи (раздел «Оформление» на «О сервисе»)", () => {
    const out = html(<ThemeSwitch current="light" legend="Цветовая тема" />);
    expect(out).toContain("Цветовая тема");
  });
});
