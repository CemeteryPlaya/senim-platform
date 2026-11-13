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

      it("один h1 — обещание продукта", () => {
        expect(count(out, "<h1")).toBe(1);
        expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.title);
      });

      it("одно главное действие «Заказать мебель» и вторая ссылка «Я мастер» — на вход с разной ролью", () => {
        expect(count(out, "data-primary-action")).toBe(1);
        const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
        expect(primary?.[1]).toBe(t.clientAction);
        expect(primary?.[0]).toContain('href="/v2/login?role=client"');
        const master = out.match(/<a [^>]*href="\/v2\/login\?role=executor"[^>]*>([^<]*)<\/a>/);
        expect(master?.[1]).toBe(t.executorAction);
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

      it("фотографий нет", () => {
        expect(out).not.toContain("<img");
        expect(out).not.toContain("<picture");
      });
    });
  }

  it("компьютер: сверху заголовок и действия | доверие, ниже шаги | «Помощь»", () => {
    const out = html(<GuestHome device="desktop" />);
    const grids = out.match(/<div [^>]*desktop:grid-cols-split[^>]*>/g) ?? [];
    expect(grids).toHaveLength(2);
    expect(hasClass(grids[0] ?? "", "desktop:grid")).toBe(true);
    const at = (s: string) => out.indexOf(s);
    const second = out.indexOf(grids[1] ?? "", at(grids[0] ?? "") + 1);
    const order = [
      at("<h1"),
      at("data-primary-action"),
      at(`>${t.trustTitle}</h2>`),
      second,
      at(`>${t.stepsTitle}</h2>`),
      at(`>${ru.app.kit.help.title}</h2>`),
    ];
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("телефон: главное действие — в доке, последним в странице; компьютер: в доке нет прилипания, но он рядом с заголовком", () => {
    const mobile = html(<GuestHome device="mobile" />);
    expect(mobile.indexOf("mobile:sticky")).toBeGreaterThan(mobile.indexOf(`>${ru.app.kit.help.title}</h2>`));
    expect(mobile.indexOf("data-primary-action")).toBeGreaterThan(mobile.indexOf(`>${ru.app.kit.help.title}</h2>`));
  });

  it("разделы через Stack section, карточки группы — через Stack group", () => {
    const out = html(<GuestHome device="desktop" />);
    expect(out).toMatch(/^<div class="[^"]*gap-stack-section/);
    expect(out).toContain("gap-stack-group");
  });

  it("в текстах нет запретных слов", () => {
    const all = JSON.stringify(ru.app.guest);
    expect(all).not.toMatch(/эскроу|комисси|демо|тестов/i);
    expect(all).toContain("Защита сделки (2%)");
  });
});
