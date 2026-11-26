import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { mosaicShape, stepIndex, swipeDelta } from "./gallery-logic";
import { bypassOptimizer } from "./PhotoImage";
import { PhotoChoice, PhotoChoiceGroup, PhotoGallery, PhotoSlot, WorkCard } from "./index";
import { count, hasClass, html, text } from "./test-utils";

describe("gallery-logic", () => {
  it("stepIndex ходит по кругу", () => {
    expect(stepIndex(0, -1, 5)).toBe(4);
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(2, 1, 5)).toBe(3);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
  it("swipeDelta: только заметный горизонтальный жест", () => {
    expect(swipeDelta(-80, 5)).toBe(1);
    expect(swipeDelta(80, 5)).toBe(-1);
    expect(swipeDelta(20, 0)).toBe(0);
    expect(swipeDelta(-60, 50)).toBe(0);
  });
  it("mosaicShape", () => {
    expect([0, 1, 2, 3, 9].map(mosaicShape)).toEqual([null, "one", "two", "three", "three"]);
  });
});

describe("PhotoSlot и next/image", () => {
  it("статика интерфейса идёт через оптимизатор, загрузки людей — нет", () => {
    expect(bypassOptimizer("/stand-photos/a.webp")).toBe(false);
    expect(bypassOptimizer("/api/files/x?sig=1")).toBe(true);
    const out = html(<PhotoSlot alt="Кухня" ratio="4/3" src="/stand-photos/a.webp" sizes="50vw" />);
    expect(out).toContain("/_next/image?url=%2Fstand-photos%2Fa.webp");
    expect(out).toContain('sizes="50vw"');
    expect(hasClass(out, "photo-reveal")).toBe(true);
    expect(hasClass(out, "photo-frame")).toBe(true);
  });
});

describe("WorkCard: цена на фото", () => {
  const photo = { src: "/f/1.jpg", alt: "Кухня" };
  it("с фото цена в капсуле glass-clear под затемнением, в тексте её нет", () => {
    const out = html(<WorkCard title="К" meta="М" media="slot" priceFrom={1000n} photo={photo} />);
    expect(out).toContain("scrim-photo-soft");
    expect(out).toContain("photo-overlay");
    expect(count(out, "от ")).toBe(1);
    expect(out).toMatch(/<p class="glass-clear[^"]*">от /);
  });
  it("без фото цена остаётся в тексте: белый на светлой заливке нечитаем", () => {
    const out = html(<WorkCard title="К" meta="М" media="slot" priceFrom={1000n} />);
    expect(out).not.toContain("glass-clear");
    expect(text(<WorkCard title="К" meta="М" media="slot" priceFrom={1000n} />)).toContain("от ");
  });
});

describe("PhotoChoice", () => {
  it("радио с подписью под фото; фото — украшение (alt пустой); галочка выбранной", () => {
    const out = html(<PhotoChoice name="r" value="a" label="Кухня" description="Описание" photo={{ src: "/stand-photos/a.webp" }} defaultChecked />);
    expect(out).toContain('type="radio"');
    expect(out).toContain('checked=""');
    expect(out).toContain('alt=""');
    expect(out).toContain("group-has-checked:opacity-100");
    expect(out.indexOf("Кухня")).toBeGreaterThan(out.indexOf("<img"));
    expect(out).toMatch(/aria-labelledby="[^"]*-label"/);
    expect(out).toMatch(/aria-describedby="[^"]*-description"/);
  });
  it("без фото — заливка со значком, без <img", () => {
    const out = html(<PhotoChoice name="r" value="a" label="Другое" icon={<svg data-icon />} />);
    expect(out).not.toContain("<img");
    expect(out).toContain("data-icon");
  });
  it("группа: legend для диктора, две колонки, ошибка", () => {
    const out = html(<PhotoChoiceGroup legend="Что" error="Выберите"><PhotoChoice name="r" value="a" label="А" /></PhotoChoiceGroup>);
    expect(out).toContain('<legend class="sr-only">Что</legend>');
    expect(hasClass(out, "grid-cols-2")).toBe(true);
    expect(out).toContain('role="alert"');
  });
});

describe("PhotoGallery (закрытая)", () => {
  const photos = Array.from({ length: 5 }, (_, i) => ({ src: `/stand-photos/${i}.webp`, alt: `Работа ${i}`, caption: "К" }));
  it("мозаика: три плитки-кнопки, капсула «Все фото (5)», окна нет", () => {
    const out = html(<PhotoGallery photos={photos} layout="mosaic" label="Работы" />);
    expect(count(out, "<button")).toBe(3);
    expect(out).toContain(ru.app.kit.gallery.all(5));
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).not.toContain('role="dialog"');
  });
  it("лента: плитка на каждый снимок", () => {
    expect(count(html(<PhotoGallery photos={photos} layout="strip" label="Ход" />), "<button")).toBe(5);
  });
  it("обложка: одна кнопка 16 : 9 на первый снимок (остальные — в галерее), слой поверх", () => {
    const out = html(<PhotoGallery photos={photos} layout="cover" label="Обложка" overlay={<span>Шаг 2 из 5</span>} />);
    expect(count(out, "<button")).toBe(1);
    expect(hasClass(out, "aspect-video")).toBe(true);
    expect(out).toContain('alt="Работа 0"');
    expect(out).not.toContain('alt="Работа 1"');
    expect(out).toContain("Шаг 2 из 5");
  });
  it("пусто — ничего", () => {
    expect(html(<PhotoGallery photos={[]} layout="mosaic" label="x" />)).toBe("");
  });
});

describe("WorkCard: порядок и приоритет", () => {
  it("название раньше цены в разметке; фото сверху на экране (flex-col-reverse)", () => {
    const out = html(<WorkCard href="/v2/x" title="Кухня" meta="М" media="slot" priceFrom={1000n} photo={{ src: "/f/1.jpg", alt: "К" }} />);
    expect(out.indexOf("Кухня")).toBeLessThan(out.indexOf("от "));
    expect(hasClass(out, "flex-col-reverse")).toBe(true);
  });
  it("priority: фото без ленивой загрузки", () => {
    const out = html(<WorkCard title="К" meta="М" media="slot" photo={{ src: "/f/1.jpg", alt: "К" }} priority />);
    expect(out).not.toContain('loading="lazy"');
  });
});
