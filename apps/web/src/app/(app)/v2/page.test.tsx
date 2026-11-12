import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { count, hasClass, html } from "@/kit/test-utils";
import V2Home from "./page";

const t = ru.app.shell.preview;
const out = html(<V2Home />);

describe("временная главная /v2", () => {
  it("одно главное действие — «Создать заявку» в пустом экране", () => {
    expect(count(out, "data-primary-action")).toBe(1);
    const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
    expect(primary?.[0]).toContain('href="/v2/requests/new"');
    expect(primary?.[1]).toBe(t.emptyAction);
  });

  it("заголовок экрана по смыслу, а не название продукта; один h1", () => {
    expect(count(out, "<h1")).toBe(1);
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.title);
    expect(t.title).not.toBe(ru.common.brand);
  });

  it("«Сейчас» называет оставшийся первый шаг", () => {
    const step = "какая мебель нужна";
    expect(t.nowTitle).toContain(step);
    expect(t.stepTwo).toContain(step);
    expect(out).toContain(`>${t.nowTitle}</h2>`);
    expect(out).toContain(t.stepTwo);
  });

  it("Split: слева шаги, «Сейчас» и пустой экран, справа только «Помощь» (телефон — тот же порядок колонкой)", () => {
    const grid = out.match(/<div [^>]*desktop:grid-cols-split[^>]*>/)?.[0] ?? "";
    expect(hasClass(grid, "desktop:grid")).toBe(true);
    const at = (s: string) => out.indexOf(s);
    expect(at(grid)).toBeGreaterThanOrEqual(0);
    const order = [t.stepTwo, t.nowTitle, t.emptyTitle, ru.app.kit.help.title].map(at);
    expect(order.every((i) => i > at(grid))).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Колонки: main — до «Помощи», aside — только «Помощь».
    const columns = out.slice(at(grid)).match(/<div class="min-w-0">/g) ?? [];
    expect(columns).toHaveLength(2);
    const aside = out.slice(out.lastIndexOf('<div class="min-w-0">'));
    expect(aside).toContain(ru.app.kit.help.title);
    expect(aside).not.toContain(t.emptyTitle);
  });

  it("разделы через 24/32 px (Stack section), карточки группы — через 12 px", () => {
    expect(out).toMatch(/^<div class="[^"]*gap-stack-section/);
    expect(out).toContain("gap-stack-group");
  });
});
