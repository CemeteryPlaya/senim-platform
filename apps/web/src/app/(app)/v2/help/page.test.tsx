import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import { HELP_ANCHORS } from "./anchors";

const h = vi.hoisted(() => ({ guest: true, device: "desktop" as "mobile" | "desktop" }));

// Барьер первых шагов проверяет onboarding-gate.test.tsx; здесь гость или вошедший, прошедший их.
vi.mock("../../_shell/auth", () => ({ userPastOnboarding: async () => (h.guest ? null : { role: "CLIENT" }) }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));

const { default: HelpPage } = await import("./page");
const t = ru.app.profile.help;
const render = async () => html(await HelpPage());

beforeEach(() => {
  h.guest = true;
  h.device = "desktop";
});

describe("/v2/help", () => {
  it.each(["mobile", "desktop"] as const)("%s: один h1, «Назад: Главная», без главного действия, каждый раздел с якорем", async (device) => {
    h.device = device;
    const out = await render();
    expect(count(out, "<h1")).toBe(1);
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.title);
    expect(count(out, "data-primary-action")).toBe(0);
    expect(out).toContain('href="/v2"');
    const ids = [...out.matchAll(/<h2 id="([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(Object.values(HELP_ANCHORS));
  });

  it("открыта и гостю, и вошедшему", async () => {
    expect(await render()).toContain(t.how.title);
    h.guest = false;
    expect(await render()).toContain(t.how.title);
  });

  it("оглавление ведёт на якоря этой страницы: на компьютере справа, на телефоне сверху перед первой секцией; один раз", async () => {
    for (const device of ["desktop", "mobile"] as const) {
      h.device = device;
      const out = await render();
      for (const id of Object.values(HELP_ANCHORS)) expect(count(out, `href="/v2/help#${id}"`)).toBe(1);
      const toc = out.indexOf(`>${t.tocTitle}</h2>`);
      const first = out.indexOf(`<h2 id="${HELP_ANCHORS.how}"`);
      expect(toc).toBeGreaterThan(-1);
      // Телефон: оглавление раньше первой секции; компьютер: справа, то есть в разметке после основной колонки.
      expect(device === "mobile" ? toc < first : toc > first).toBe(true);
    }
  });

  it("основной текст секций — 17 px (text-body), не мельче", async () => {
    const out = await render();
    expect(out).toContain('class="text-body text-ink"');
    expect(out).not.toMatch(/class="text-(sub|small)[^"]*"[^>]*>Деньги лежат/);
  });

  it("поддержка — адрес из конфига бренда; деньги не проходят через счета сервиса; слов «комиссия» и «эскроу» нет", async () => {
    const out = await render();
    expect(out).toContain('href="mailto:');
    expect(out).toContain(t.money.paragraphs[1]);
    expect(out.toLowerCase()).not.toMatch(/комисси|эскроу|платформ|демо|тестов|отклик/);
    expect(out).toContain("Защита сделки (2%)");
  });
});
