import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { count, hasClass, html } from "@/kit/test-utils";
import { ABOUT_ANCHORS } from "../about/anchors";
import { GuestHome } from "./GuestHome";

const t = ru.app.guest.home;

describe("главная гостя", () => {
  for (const device of ["mobile", "desktop"] as const) {
    describe(device, () => {
      const out = html(<GuestHome device={device} />);

      it("один h1 — обещание продукта, без висящих слов (text-balance)", () => {
        expect(count(out, "<h1")).toBe(1);
        expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.title);
        expect(hasClass(out.match(/<h1[^>]*>/)?.[0] ?? "", "text-balance")).toBe(true);
      });

      it("одно главное действие «Заказать мебель»; ссылка мастера — на вход с другой ролью и не главная", () => {
        expect(count(out, "data-primary-action")).toBe(1);
        const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
        expect(primary?.[1]).toBe(t.clientAction);
        expect(primary?.[0]).toContain('href="/v2/login?role=client"');
        const master = out.match(/<a [^>]*href="\/v2\/login\?role=executor"[^>]*>(.*?)<\/a>/);
        expect(master?.[1].replace(/<[^>]*>/g, "")).toBe(t.executorLink);
        expect(master?.[0]).not.toContain("data-primary-action");
      });

      it("три шага карточками, блок доверия с пояснением и «Помощь» с тремя вопросами", () => {
        expect(out).toContain(`>${t.stepsTitle}</h2>`);
        for (const step of t.steps) expect(out).toContain(`>${step.title}</h3>`);
        expect(t.steps).toHaveLength(3);
        expect(out).toContain(`>${t.trustTitle}</h2>`);
        expect(out).toContain(t.explainLabel);
        const helpLinks = [...out.matchAll(/<a [^>]*href="(\/v2\/about#[a-z]+)"/g)].map((m) => m[1]);
        expect(helpLinks).toEqual([
          `/v2/about#${ABOUT_ANCHORS.money}`,
          `/v2/about#${ABOUT_ANCHORS.price}`,
          `/v2/about#${ABOUT_ANCHORS.refusal}`,
        ]);
      });

      it("текст шагов основным цветом, серая только подпись «Шаг N»", () => {
        const step = out.match(new RegExp(`<p class="([^"]*)">${t.steps[0].text}</p>`));
        expect(step?.[1]).toContain("text-ink");
        expect(out).toMatch(/<p class="[^"]*text-muted">Шаг 1<\/p>/);
      });

      it("фотографий нет", () => {
        expect(out).not.toContain("<img");
        expect(out).not.toContain("<picture");
      });
    });
  }

  it("компьютер: Split — заголовок, кнопка и ссылка мастера | доверие; ниже шаги тремя в ряд; «Помощь» в Narrow", () => {
    const out = html(<GuestHome device="desktop" />);
    const grids = out.match(/<div [^>]*desktop:grid-cols-split[^>]*>/g) ?? [];
    expect(grids).toHaveLength(1);
    expect(hasClass(grids[0] ?? "", "desktop:grid")).toBe(true);
    expect(out).toContain("desktop:grid-cols-3");
    const at = (s: string) => out.indexOf(s);
    const order = [
      at("<h1"),
      at("data-primary-action"),
      at("role=executor"),
      at(`>${t.trustTitle}</h2>`),
      at(`>${t.stepsTitle}</h2>`),
      at(`>${ru.app.kit.help.title}</h2>`),
    ];
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(out.slice(out.lastIndexOf("desktop:max-w-narrow"))).toContain(ru.app.kit.help.title);
  });

  it("телефон: в панели действий одна главная кнопка и она последняя; ссылка мастера — до шагов, на первом экране", () => {
    const out = html(<GuestHome device="mobile" />);
    const dock = out.slice(out.indexOf("mobile:sticky") - 200);
    expect(count(dock, "<a ")).toBe(1);
    expect(dock).toContain("data-primary-action");
    expect(out.indexOf("data-primary-action")).toBeGreaterThan(out.indexOf(`>${ru.app.kit.help.title}</h2>`));
    expect(out.indexOf("role=executor")).toBeLessThan(out.indexOf(`>${t.stepsTitle}</h2>`));
    expect(out.indexOf("role=executor")).toBeGreaterThan(out.indexOf("<h1"));
  });

  it("компьютер: панель действий — обычный блок в ряд, прилипание только у варианта mobile:", () => {
    const dock = html(<GuestHome device="desktop" />).match(/<div [^>]*data-action-dock[^>]*>/)?.[0] ?? "";
    expect(hasClass(dock, "desktop:flex-row")).toBe(true);
    expect(hasClass(dock, "mobile:sticky")).toBe(true);
    expect(hasClass(dock, "sticky")).toBe(false);
  });

  it("разделы через Stack section, карточки группы — через Stack group", () => {
    const out = html(<GuestHome device="desktop" />);
    expect(out).toMatch(/^<div class="[^"]*gap-stack-section/);
    expect(out).toContain("gap-stack-group");
  });

  it("в текстах нет запретных слов и слова «приёмка»; предлог «в» в заголовке не отрывается", () => {
    const all = JSON.stringify(ru.app.guest.home) + JSON.stringify(ru.app.guest.about);
    expect(all).not.toMatch(/эскроу|комисси|демо|тестов/i);
    expect(JSON.stringify(ru.app.guest.home)).not.toMatch(/приёмк/i);
    expect(all).toContain("Защита сделки (2%)");
    expect(t.title).toContain("в банке");
  });
});
