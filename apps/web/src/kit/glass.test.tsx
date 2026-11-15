import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POPOVER_MATERIALS } from "./Popover";
import { sheetShape } from "./Sheet";
import { TOAST_MATERIAL, toastClassNames } from "./Toaster";
import { hasClass, html, text } from "./test-utils";
import { BackLink, Card, Explain, List, ListRow, Menu, Monogram, monogramOf, NavLens, PageTitle } from "./index";

// Пересмотр вида (разбор 3.4, 3.6): стекло в слое навигации и меню, виды карточки, строка списка, монограмма.
const source = (file: string) => readFileSync(path.join(__dirname, file), "utf8");

describe("на стекле — только ink и glass-secondary (вариант onGlass)", () => {
  it("PageTitle onGlass: «Назад» и пояснение — glass-secondary, ни muted, ни accent", () => {
    const out = html(<PageTitle title="Исполнитель №8" back={{ href: "/v2/chats", label: "Чаты" }} lead="Сделка" onGlass />);
    expect(out).not.toMatch(/\btext-(?:muted|accent)\b/);
    expect(hasClass(out, "text-glass-secondary")).toBe(true);
    expect(text(<PageTitle title="Т" back={{ href: "/x", label: "Чаты" }} onGlass />)).toContain("Чаты");
  });

  it("без onGlass — прежний вид: muted", () => {
    expect(hasClass(html(<BackLink href="/x" label="Чаты" />), "text-muted")).toBe(true);
    expect(hasClass(html(<PageTitle title="Т" lead="Л" />), "text-muted")).toBe(true);
  });

  it("Explain onGlass: ссылка ink с подчёркиванием, не accent", () => {
    const out = html(
      <Explain label="Почему?" title="Почему скрыто" device="mobile" onGlass>
        x
      </Explain>,
    );
    for (const cls of ["text-ink", "underline"]) expect(hasClass(out, cls), cls).toBe(true);
    expect(out).not.toContain("text-accent");
  });
});

describe("меню, поповеры, тосты, шторка", () => {
  it("Menu: «…» — круг 48 px; на телефоне на стекле, на компьютере без материала; список компьютера — glass-thick из кнопки", () => {
    const items = [{ label: "История денег", href: "/v2/money" }];
    const mobile = html(<Menu label="Действия" items={items} device="mobile" />);
    for (const cls of ["glass-regular", "rounded-full", "size-control"]) expect(hasClass(mobile, cls), cls).toBe(true);
    const desktop = html(<Menu label="Действия" items={items} device="desktop" />);
    expect(hasClass(desktop, "glass-regular")).toBe(false);
    expect(hasClass(desktop, "hover:bg-fill")).toBe(true);
    const code = source("Menu.tsx");
    expect(code).toMatch(/glass-thick[^"]*origin-\(--radix-dropdown-menu-content-transform-origin\)/);
    expect(code).toContain("presence(reduced, { scale: 0.96 })");
    expect(code).not.toContain("bg-raised");
  });

  it("Popover: по умолчанию сплошной (длинный текст на стекле запрещён), glass — толстое стекло; масштаб 0,96", () => {
    expect(POPOVER_MATERIALS.solid.split(" ")).toEqual(expect.arrayContaining(["bg-raised", "shadow-overlay"]));
    expect(POPOVER_MATERIALS.glass).toBe("glass-thick");
    expect(source("Popover.tsx")).toContain("presence(reduced, { scale: 0.96 })");
  });

  it("тост: компьютер — толстое стекло; телефон — сплошной (сверху он лёг бы на стекло шапки и круглых кнопок)", () => {
    expect(TOAST_MATERIAL.desktop).toBe("glass-thick");
    expect(TOAST_MATERIAL.mobile.split(" ")).toEqual(["bg-raised", "shadow-overlay"]);
    expect(TOAST_MATERIAL.mobile).not.toContain("glass");
    expect(toastClassNames.toast).not.toMatch(/glass|bg-raised|shadow-/);
    expect(toastClassNames.description.split(" ")).toContain("text-glass-secondary");
    expect(toastClassNames.cancelButton).not.toContain("text-muted");
    expect(toastClassNames.actionButton.split(" ")).toContain("bg-fill");
  });

  it("шторка в форме iOS 26: неполная — 8 px от краёв и низа, радиус 32 со всех сторон; полная — к краям, 24 сверху", () => {
    const floating = sheetShape(false);
    expect(floating.className.split(" ")).toEqual(["inset-x-2", "bottom-2", "rounded-sheet"]);
    expect(floating.style).toEqual({ "--initial-transform": "calc(100% + 0.5rem)" });
    const full = sheetShape(true);
    expect(full.className.split(" ")).toEqual(["inset-x-0", "bottom-0", "rounded-t-sheet-full"]);
    expect(full.style).toBeUndefined();
    // Продолжение фона vaul под висящей шторкой выключено — зазор 8 px остаётся пустым.
    expect(source("overlays.css")).toMatch(/\[data-vaul-drawer\]\[data-sheet-float\]::after\s*\{\s*display:\s*none !important;/);
  });
});

describe("Card: обычная, герой, сгруппированный список", () => {
  it("обычная — отступ 16 px, без тени", () => {
    const out = html(<Card>x</Card>);
    for (const cls of ["rounded-card", "bg-surface", "p-4"]) expect(hasClass(out, cls), cls).toBe(true);
    expect(out).not.toContain("shadow");
  });

  it("герой — отступ 24 px, обложка 16:9 во всю ширину сверху в рамке фото", () => {
    const out = html(
      <Card variant="hero" cover={<img src="/p.webp" alt="Кухня" />}>
        <p>Сумма</p>
      </Card>,
    );
    expect(out).toContain('data-card="hero"');
    expect(hasClass(out, "overflow-hidden")).toBe(true);
    expect(out).toMatch(/class="photo-frame aspect-16\/9[^"]*"><img/);
    expect(hasClass(out, "p-6")).toBe(true);
    expect(out.indexOf("<img")).toBeLessThan(out.indexOf("Сумма"));
    expect(html(<Card variant="hero">x</Card>)).not.toContain("photo-frame");
  });

  it("сгруппированный — без отступа, подсветка строк не выходит за скругление", () => {
    const out = html(<Card variant="grouped">x</Card>);
    for (const cls of ["overflow-hidden", "rounded-card"]) expect(hasClass(out, cls), cls).toBe(true);
    expect(hasClass(out, "p-4")).toBe(false);
  });

  it("кликабельная — тень и подъём только при наведении и только на компьютере", () => {
    const out = html(<Card interactive>x</Card>);
    for (const cls of ["desktop:hover:shadow-hover", "desktop:hover:-translate-y-0.5"]) expect(hasClass(out, cls), cls).toBe(true);
    const classes = /class="([^"]*)"/.exec(out)?.[1].split(" ") ?? [];
    expect(classes.filter((cls) => cls.includes("shadow") && !cls.startsWith("desktop:hover:"))).toEqual([]);
    expect(html(<Card>x</Card>)).not.toContain("hover:");
  });
});

describe("ListRow: миниатюра или монограмма слева, вторая строка", () => {
  it("с leading — строка 56 px, разделитель от начала текста (какой бы ширины ни была монограмма или миниатюра)", () => {
    const out = html(
      <List>
        <ListRow label="Кухня" detail="Шаг 2 из 5" value="21 окт" href="/v2/deals/1" leading={<Monogram name="Исполнитель №8" size="md" />} />
      </List>,
    );
    expect(hasClass(out, "min-h-14")).toBe(true);
    // Строка сама не рисует линию от края: её рисует колонка текста — от своего начала, до края карточки и низа строки.
    const li = /<li[^>]*>/.exec(out)?.[0] ?? "";
    expect(li).not.toContain("after:border-b");
    const column = /<span data-row-text="true"[^>]*>/.exec(out)?.[0] ?? "";
    for (const cls of ["after:left-0", "after:-right-4", "after:-bottom-2", "after:border-line", "group-last/row:after:hidden", "self-stretch"]) {
      expect(hasClass(column, cls), cls).toBe(true);
    }
    expect(out).toContain('<span class="text-headline text-ink">Кухня</span><span class="line-clamp-2 text-sub text-muted">Шаг 2 из 5</span>');
    expect(out.indexOf("№8")).toBeLessThan(out.indexOf("Кухня"));
    // Шеврон 16 px muted.
    expect(out).toMatch(/lucide-chevron-right[^"]*size-4 shrink-0 text-muted/);
  });

  it("без leading — разделитель с отступом 16 px, строка прежней высоты", () => {
    const out = html(
      <List>
        <ListRow label="Статус" value="Идёт" />
      </List>,
    );
    expect(hasClass(out, "after:left-4")).toBe(true);
    expect(out).not.toContain("min-h-14");
  });
});

describe("Monogram", () => {
  it.each([
    ["Исполнитель №8", "№8"],
    ["Исполнитель № 12", "№12"],
    ["Исполнитель №104", "104"],
    ["Мастер № 1042", "1042"],
    ["Айгерим Сапарова", "АС"],
    ["айгерим", "А"],
    ["  ", null],
    [null, null],
  ] as const)("%s → %s", (name, expected) => {
    expect(monogramOf(name)).toBe(expected);
  });

  it.each([
    ["sm", "size-avatar"],
    ["md", "size-avatar-md"],
    ["lg", "size-avatar-lg"],
  ] as const)("%s: круг %s, заливка fill, текст ink 600, скрыт от диктора", (size, cls) => {
    const out = html(<Monogram name="Исполнитель №8" size={size} />);
    for (const c of [cls, "rounded-full", "bg-fill", "text-ink", "font-semibold"]) expect(hasClass(out, c), c).toBe(true);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain(">№8<");
  });

  it.each([
    ["sm", "text-sub", "text-small"],
    ["md", "text-headline", "text-sub"],
    ["lg", "text-title-2", "text-headline"],
  ] as const)("%s: длинный номер («1042») — кегль на ступень меньше (%s → %s), один размер текста", (size, normal, long) => {
    const short = html(<Monogram name="Исполнитель №8" size={size} />);
    expect(hasClass(short, normal)).toBe(true);
    const out = html(<Monogram name="Мастер № 1042" size={size} />);
    expect(out).toContain(">1042<");
    expect(hasClass(out, long)).toBe(true);
    expect(hasClass(out, normal)).toBe(false);
  });

  it("без имени — значок человека", () => {
    expect(html(<Monogram name={null} />)).toContain("lucide-user-round");
  });
});

describe("NavLens", () => {
  it("подложка fill-strong под содержимым пункта, капсула или скругление поля, скрыта от диктора", () => {
    const capsule = html(<NavLens group="tabs" />);
    for (const cls of ["absolute", "inset-0", "-z-10", "bg-fill-strong", "rounded-chip"]) expect(hasClass(capsule, cls), cls).toBe(true);
    expect(capsule).toContain('aria-hidden="true"');
    expect(hasClass(html(<NavLens group="tabs" shape="field" />), "rounded-field")).toBe(true);
  });

  it("переезжает пружиной без отскока; при меньшем движении — мгновенно", () => {
    const code = source("NavLens.tsx");
    expect(code).toContain("layoutId={`nav-lens-${group}`}");
    expect(code).toContain("transition={reduced ? { duration: 0 } : SPRING.default}");
  });
});
