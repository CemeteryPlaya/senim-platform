import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, hasClass, html } from "@/kit/test-utils";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));

const { default: V2Home } = await import("./page");

const t = ru.app.shell.preview;
const render = async (): Promise<string> => html(await V2Home());

beforeEach(() => {
  h.device = "mobile";
});

describe("временная главная /v2", () => {
  it.each(["mobile", "desktop"] as const)("%s: одно главное действие — «Создать заявку» в пустом экране", async (device) => {
    h.device = device;
    const out = await render();
    expect(count(out, "data-primary-action")).toBe(1);
    const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
    expect(primary?.[0]).toContain('href="/v2/requests/new"');
    expect(primary?.[1]).toBe(t.emptyAction);
    expect(out).toContain(t.emptyTitle);
    expect(count(out, "<h1")).toBe(1);
  });

  it("телефон: одна колонка без сетки; порядок — шаги, «Сейчас», пустой экран, «Помощь»", async () => {
    const out = await render();
    expect(out).not.toContain("desktop:grid");
    const order = [t.stepTwo, t.nowTitle, t.emptyTitle, ru.app.kit.help.title].map((s) => out.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("компьютер: сетка 1,5 : 1 — слева шаги и «Сейчас», справа «Помощь»; пустой экран под сеткой", async () => {
    h.device = "desktop";
    const out = await render();
    const grid = out.match(/<div [^>]*desktop:grid-cols-split[^>]*>/)?.[0] ?? "";
    expect(hasClass(grid, "desktop:grid")).toBe(true);
    const gridAt = out.indexOf(grid);
    const helpAt = out.indexOf(ru.app.kit.help.title);
    expect(out.indexOf(t.stepTwo)).toBeGreaterThan(gridAt);
    expect(out.indexOf(t.nowTitle)).toBeLessThan(helpAt);
    expect(out.indexOf(t.emptyTitle)).toBeGreaterThan(helpAt);
  });

  it("разделы через 24/32 px (Stack section), карточки группы — через 12 px", async () => {
    const out = await render();
    expect(out).toMatch(/^<div class="[^"]*gap-stack-section/);
    expect(out).toContain("gap-stack-group");
  });
});
