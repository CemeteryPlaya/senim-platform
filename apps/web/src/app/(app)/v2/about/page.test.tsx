import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { count, hasClass, html } from "@/kit/test-utils";
import { computeDealMoney } from "@/modules/payments";
import { GuestHome } from "../_home/GuestHome";
import { ABOUT_ANCHORS } from "./anchors";

type Role = "CLIENT" | "EXECUTOR" | "OPERATOR" | "MEASURER";

const h = vi.hoisted(() => ({
  shell: { user: null as { role: Role } | null, unavailable: false },
  device: "desktop" as "mobile" | "desktop",
  theme: "system" as "system" | "light" | "dark",
}));

// Барьер первых шагов проверяет onboarding-gate.test.tsx; здесь вошедший их уже прошёл (или гость).
vi.mock("../../_shell/auth", () => ({ userPastOnboarding: async () => h.shell.user }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("@/kit/theme", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/kit/theme")>()), getTheme: async () => h.theme }));
// Действия сервера в статическом рендере не вызываются; модуль действия тянет env и базу.
vi.mock("../../_shell/theme-actions", () => ({ chooseTheme: vi.fn(async () => undefined) }));

const { default: AboutPage } = await import("./page");

const t = ru.app.guest.about;
const render = async () => html(await AboutPage());

beforeEach(() => {
  h.shell = { user: null, unavailable: false };
  h.device = "desktop";
  h.theme = "system";
});

describe("/v2/about: структура", () => {
  it("один h1 и «Назад: Главная»", async () => {
    const out = await render();
    expect(count(out, "<h1")).toBe(1);
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.title);
    expect(out).toContain('href="/v2"');
    expect(out).toContain(t.backLabel);
  });

  it("четыре раздела h2 с якорями из anchors.ts; запас над заголовком при переходе по якорю", async () => {
    const out = await render();
    const headings = out.match(/<h2 id="[a-z]+"[^>]*>/g) ?? [];
    expect(headings.map((x) => x.match(/id="([a-z]+)"/)?.[1])).toEqual(Object.values(ABOUT_ANCHORS));
    for (const tag of headings) expect(hasClass(tag, "desktop:scroll-anchor")).toBe(true);
    expect(out).toContain(`>${t.refusal.title}</h2>`);
  });

  it("каждый якорь из «Помощи» главной существует на «О сервисе»", async () => {
    const out = await render();
    const ids = [...out.matchAll(/<h2 id="([a-z]+)"/g)].map((m) => m[1]);
    const home = html(<GuestHome device="desktop" />);
    const hashes = [...home.matchAll(/href="\/v2\/about#([a-z]+)"/g)].map((m) => m[1]);
    expect(hashes).toHaveLength(3);
    for (const hash of hashes) expect(ids).toContain(hash);
  });

  it("фотографий нет, запретных слов нет", async () => {
    expect(await render()).not.toContain("<img");
    expect(JSON.stringify(t)).not.toMatch(/эскроу|комисси|демо|тестов/i);
  });
});

describe("/v2/about: цена по ролям", () => {
  it("покупатель — «Только цена мастера, без доплат» и «Гарантия оплаты и клиента (6%)» для мастера — отдельными карточками", async () => {
    const out = await render();
    expect(out).toContain(`>${t.price.buyerTitle}</h3>`);
    expect(out).toContain(`>${t.price.masterTitle}</h3>`);
    expect(t.price.buyerTitle).toBe("Только цена мастера, без доплат");
    expect(out).not.toMatch(/Защита сделки|2\s?%/);
    expect(t.price.masterTitle).toContain("Гарантия оплаты и клиента (6%)");
    expect(out).not.toContain("Заявка бесплатная");
  });

  it("над карточками подписи ролей: «вы платите» и «вы получите» не читаются как обращённые к одному человеку", async () => {
    const out = await render();
    const at = (s: string) => out.indexOf(s);
    expect(at(t.price.buyerLabel)).toBeGreaterThan(0);
    expect(at(t.price.buyerLabel)).toBeLessThan(at(`>${t.price.buyerTitle}</h3>`));
    expect(at(t.price.masterLabel)).toBeGreaterThan(at(`>${t.price.buyerTitle}</h3>`));
    expect(at(t.price.masterLabel)).toBeLessThan(at(`>${t.price.masterTitle}</h3>`));
    expect(count(out, "<h1")).toBe(1);
  });

  it("пример: 200 000 ₸ → покупатель платит 200 000 ₸, мастер получает 188 000 ₸ — из одного значения и сверено с computeDealMoney", async () => {
    const price = 200_000n * 100n;
    const protection = 0n; // ADR-015: покупатель платит цену без доплат
    const guarantee = (price * 6n) / 100n;
    const money = computeDealMoney(price);
    expect(money.buyerTotalTiyn).toBe(price + protection);
    expect(money.payoutTiyn).toBe(price - guarantee);
    const out = await render();
    expect(out).toContain(`${t.price.buyerPrice} <span class="whitespace-nowrap tabular-nums text-ink">${formatMoney(price)}</span>`);
    expect(out).toContain(formatMoney(price + protection));
    expect(out).toContain(formatMoney(price - guarantee));
    expect(formatMoney(price + protection).replace(/\s/g, " ")).toBe("200 000 ₸");
    expect(formatMoney(price - guarantee).replace(/\s/g, " ")).toBe("188 000 ₸");
  });
});

describe("/v2/about: главное действие по роли", () => {
  it("гость на компьютере: кнопка в правой колонке (оглавление без шевронов), внизу страницы её нет, колонка прилипает", async () => {
    const out = await render();
    expect(count(out, "data-primary-action")).toBe(1);
    const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
    expect(primary?.[1]).toBe(t.clientAction);
    expect(primary?.[0]).toContain('href="/v2/login?role=client"');
    expect(out.indexOf("data-primary-action")).toBeGreaterThan(out.indexOf(t.tocTitle));
    expect(out).toContain("desktop:sticky-aside");
    const toc = out.slice(out.indexOf(`>${t.tocTitle}</h2>`), out.indexOf("data-primary-action"));
    expect(toc).not.toContain("lucide-chevron-right");
    expect(toc.match(/href="\/v2\/about#[a-z]+"/g)).toHaveLength(4);
    expect(out).toContain('href="/v2/login?role=executor"');
    expect(out).not.toContain("mobile:sticky");
  });

  it("гость на телефоне: одна кнопка в панели действий в конце, правой колонки нет", async () => {
    h.device = "mobile";
    const out = await render();
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out.indexOf("data-primary-action")).toBeGreaterThan(out.lastIndexOf("</section>"));
    expect(out).toContain("mobile:sticky");
    expect(out).not.toContain("desktop:sticky-aside");
    expect(out).not.toContain(`>${t.tocTitle}</h2>`);
  });

  it("заказчик: «Создать заявку» ведёт на новую заявку, ссылка мастера остаётся", async () => {
    h.shell = { user: { role: "CLIENT" }, unavailable: false };
    const out = await render();
    const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
    expect(primary?.[1]).toBe(t.createRequest);
    expect(primary?.[0]).toContain('href="/v2/requests/new"');
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).not.toContain("role=client");
    expect(out).toContain("role=executor");
  });

  for (const role of ["EXECUTOR", "OPERATOR"] as const) {
    it(`${role}: главного действия нет, ссылки регистрации мастера нет, входа тоже`, async () => {
      h.shell = { user: { role }, unavailable: false };
      for (const device of ["desktop", "mobile"] as const) {
        h.device = device;
        const out = await render();
        expect(out).not.toContain("data-primary-action");
        expect(out).not.toContain("/v2/login");
        expect(out).not.toContain(t.master.action);
        expect(count(out, "<h1")).toBe(1);
      }
    });
  }
});

describe("/v2/about: оформление", () => {
  it.each(["desktop", "mobile"] as const)("%s: гость видит раздел «Оформление» внизу страницы с переключателем темы", async (device) => {
    h.device = device;
    h.theme = "dark";
    const out = await render();
    const text = ru.app.shell.theme;
    // Раздел — после всех четырёх (оглавление справа на компьютере стоит в разметке позже, но это другая колонка).
    expect(out.indexOf(`>${text.section}</h2>`)).toBeGreaterThan(out.indexOf(`>${t.master.title}</h2>`));
    const section = out.slice(out.indexOf(`>${text.section}</h2>`));
    expect(section).toContain(text.sectionLegend);
    for (const label of [text.system, text.light, text.dark]) expect(section).toContain(`>${label}</button>`);
    expect(section.match(/aria-pressed="true"[^>]*>([^<]*)</)?.[1]).toBe(text.dark);
  });

  it("вошедшему переключатель тоже доступен", async () => {
    h.shell = { user: { role: "CLIENT" }, unavailable: false };
    expect(await render()).toContain(`>${ru.app.shell.theme.light}</button>`);
  });
});
