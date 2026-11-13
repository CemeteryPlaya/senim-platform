import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import AboutPage from "./page";
import { ABOUT_ANCHORS } from "./anchors";

const t = ru.app.guest.about;
const out = html(<AboutPage />);

describe("/v2/about", () => {
  it("один h1 и «Назад: Главная»", () => {
    expect(count(out, "<h1")).toBe(1);
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.title);
    expect(out).toContain('href="/v2"');
    expect(out).toContain(t.backLabel);
  });

  it("четыре раздела h2 с якорями из anchors.ts", () => {
    const ids = [...out.matchAll(/<h2 id="([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(Object.values(ABOUT_ANCHORS));
    expect(ids).toHaveLength(4);
    expect(out).toContain(`>${t.money.title}</h2>`);
    expect(out).toContain(`>${t.price.title}</h2>`);
    expect(out).toContain(`>${t.refusal.title}</h2>`);
    expect(out).toContain(`>${t.master.title}</h2>`);
  });

  it("цены по ролям — отдельными абзацами с правильными названиями", () => {
    expect(t.price.buyerText).toContain("Защита сделки (2%)");
    expect(t.price.masterText).toContain("Гарантия оплаты и клиента (4%)");
    expect(out).toContain("Защита сделки (2%)");
    expect(out).toContain("Гарантия оплаты и клиента (4%)");
  });

  it("одно главное действие «Заказать мебель» — на вход как покупатель", () => {
    expect(count(out, "data-primary-action")).toBe(1);
    const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
    expect(primary?.[1]).toBe(t.clientAction);
    expect(primary?.[0]).toContain('href="/v2/login?role=client"');
    expect(out).toContain('href="/v2/login?role=executor"');
  });

  it("фотографий нет, запретных слов нет", () => {
    expect(out).not.toContain("<img");
    expect(JSON.stringify(t)).not.toMatch(/эскроу|комисси|демо|тестов/i);
  });
});
