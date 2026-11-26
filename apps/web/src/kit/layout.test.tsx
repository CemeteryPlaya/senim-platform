import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Narrow, Section, Sidebar, Split, Stack } from "./index";
import { count, hasClass, html } from "./test-utils";

/** Открывающий тег первого элемента разметки. */
const first = (out: string): string => out.slice(0, out.indexOf(">") + 1);

describe("Stack", () => {
  it("вертикальный поток; по умолчанию зазор группы (12 px)", () => {
    const tag = first(html(<Stack>x</Stack>));
    for (const cls of ["flex", "flex-col", "gap-stack-group"]) expect(hasClass(tag, cls), cls).toBe(true);
  });

  it.each([
    ["tight", "gap-stack-tight"],
    ["group", "gap-stack-group"],
    ["section", "gap-stack-section"],
  ] as const)("gap=%s — %s, других зазоров нет", (gap, cls) => {
    const tag = first(html(<Stack gap={gap}>x</Stack>));
    expect(hasClass(tag, cls)).toBe(true);
    expect(count(tag, "gap-")).toBe(1);
  });
});

describe("Split", () => {
  it("телефон — одна колонка: main, затем aside", () => {
    const out = html(<Split main={<p>main</p>} aside={<p>aside</p>} />);
    const tag = first(out);
    for (const cls of ["flex", "flex-col", "gap-stack-section"]) expect(hasClass(tag, cls), cls).toBe(true);
    expect(out.indexOf("main")).toBeLessThan(out.indexOf("aside"));
  });

  it("компьютер — сетка 1,5 : 1 с зазором 24 px, колонки по верху; только через desktop:", () => {
    const tag = first(html(<Split main="a" aside="b" />));
    for (const cls of ["desktop:grid", "desktop:grid-cols-split", "desktop:gap-split", "desktop:items-start"]) {
      expect(hasClass(tag, cls), cls).toBe(true);
    }
    expect(hasClass(tag, "grid")).toBe(false);
  });

  it("колонки не распираются длинным содержимым", () => {
    const out = html(<Split main="a" aside="b" />);
    expect(count(out, 'class="min-w-0"')).toBe(2);
  });
});

describe("Narrow", () => {
  it("ограничивает ширину только на компьютере (560 px), на телефоне ничего не делает", () => {
    const tag = first(html(<Narrow>x</Narrow>));
    expect(hasClass(tag, "desktop:max-w-narrow")).toBe(true);
    expect(tag).not.toMatch(/class="(?:[^"]*\s)?max-w-/);
  });
});

describe("Section", () => {
  it("заголовок раздела h2 ровно по левому краю карточек: без своих отступов", () => {
    const out = html(<Section title="Помощь">x</Section>);
    expect(out).toMatch(/^<section/);
    const h2 = out.match(/<h2[^>]*>/)?.[0] ?? "";
    expect(hasClass(h2, "text-title-2")).toBe(true);
    expect(h2).not.toMatch(/[\s"](?:-?m|p)[xlrse]?-\d/);
    expect(out).toContain(">Помощь</h2>");
  });

  it("от заголовка до карточек — зазор группы (12 px)", () => {
    expect(hasClass(first(html(<Section title="Т">x</Section>)), "gap-stack-group")).toBe(true);
  });

  it("action — справа в строке заголовка, до содержимого; без него обёртки нет", () => {
    const out = html(
      <Section title="Мои заявки" action={<button type="button">Все</button>}>
        x
      </Section>,
    );
    expect(out).toMatch(/<div class="[^"]*justify-between[^"]*"><h2[^>]*>Мои заявки<\/h2><button type="button">Все<\/button><\/div>x/);
    expect(html(<Section title="Т">x</Section>)).not.toContain("justify-between");
  });
});

describe("Section с id (якорь)", () => {
  it("id ставится на h2, раздел подписан им; без id атрибутов нет", () => {
    const out = html(<Section title="Цена" id="price">x</Section>);
    expect(out).toMatch(/<h2 id="price"/);
    expect(out).toContain('aria-labelledby="price"');
    expect(html(<Section title="Цена">x</Section>)).not.toMatch(/\bid=|aria-labelledby/);
  });
});

describe("Split stickyAside и якорь раздела", () => {
  it("stickyAside прилипает боковую колонку только на компьютере; по умолчанию нет", () => {
    const sticky = html(<Split main="a" aside="b" stickyAside />);
    expect(sticky).toContain('class="min-w-0 desktop:sticky-aside"');
    expect(html(<Split main="a" aside="b" />)).not.toContain("sticky");
  });

  it("заголовок раздела с id получает запас при переходе по якорю (desktop:scroll-anchor)", () => {
    expect(html(<Section title="Т" id="x">y</Section>)).toMatch(/<h2 id="x" class="[^"]*desktop:scroll-anchor/);
    expect(html(<Section title="Т">y</Section>)).not.toContain("scroll-anchor");
  });
});

describe("Sidebar", () => {
  it("компьютер: узкая левая колонка (aside, прилипает) и основная, сетка sidebar с зазором 24 px по верху", () => {
    const out = html(<Sidebar device="desktop" aside={<p>Фильтры</p>}>Основное</Sidebar>);
    const root = first(out);
    for (const cls of ["desktop:grid", "desktop:grid-cols-sidebar", "desktop:items-start", "desktop:gap-split"]) expect(hasClass(root, cls), cls).toBe(true);
    expect(out).toContain('<div class="min-w-0 desktop:sticky-aside"><p>Фильтры</p></div>');
    expect(out).toContain('<div class="min-w-0">Основное</div>');
    expect(out.indexOf("Фильтры")).toBeLessThan(out.indexOf("Основное"));
  });

  it("телефон: только основное, aside в разметке нет", () => {
    const out = html(<Sidebar device="mobile" aside={<p>Фильтры</p>}>Основное</Sidebar>);
    expect(out).toBe('<div class="min-w-0">Основное</div>');
    expect(out).not.toContain("Фильтры");
    expect(out).not.toContain("sticky");
  });

  it("ширина колонки — именованный токен", () => {
    const css = readFileSync(path.join(__dirname, "tokens.css"), "utf8");
    expect(css).toMatch(/--sidebar-width:\s*15rem\s*;/);
    expect(css).toMatch(/--grid-template-columns-sidebar:\s*var\(--sidebar-width\)\s+minmax\(0,\s*1fr\)\s*;/);
  });
});
