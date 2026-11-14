import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { Bars, Money, Stat, StatRow, Uploader } from "./index";
import { barPercents } from "./bars-logic";
import { count, hasClass, html, text } from "./test-utils";

const NB = " ";
const noop = () => {};

describe("Stat и StatRow", () => {
  it("число и подпись: подпись перед значением в разметке, без значков и рамок", () => {
    const out = html(<Stat label="Новые заявки" value="12" />);
    expect(out).toMatch(/<dl[^>]*><dt[^>]*>Новые заявки<\/dt><dd[^>]*>12<\/dd><\/dl>/);
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("border");
    expect(hasClass(out, "flex-col-reverse")).toBe(true);
    expect(hasClass(out, "text-title")).toBe(true);
    expect(hasClass(out, "text-muted")).toBe(true);
  });

  it("compact — меньший кегль; значение — любой узел, например Money", () => {
    const out = html(<Stat label="За ноябрь" value={<Money tiyn={1_224_000_00n} />} compact />);
    expect(hasClass(out, "text-section")).toBe(true);
    expect(text(<Stat label="За ноябрь" value={<Money tiyn={1_224_000_00n} />} />)).toBe(`За ноябрь1${NB}224${NB}000${NB}₸`);
  });

  it("строка сводки: группа с именем, одна белая подложка, значения не рисуются плитками", () => {
    const out = html(
      <StatRow label="Сводка">
        <Stat label="Новые заявки" value="3" />
        <Stat label="В работе" value="1" />
      </StatRow>,
    );
    expect(out).toMatch(/^<div role="group" aria-label="Сводка"/);
    expect(hasClass(out, "bg-surface")).toBe(true);
    expect(count(out, "<dl")).toBe(2);
    expect(out).not.toContain("<svg");
  });
});

describe("Bars", () => {
  it("высота: от максимума, ноль — 0, малое ненулевое — не меньше 4%, пустое окно — нули", () => {
    expect(barPercents([100n, 50n, 0n])).toEqual([100, 50, 0]);
    expect(barPercents([1000n, 1n])).toEqual([100, 4]);
    expect(barPercents([0n, 0n])).toEqual([0, 0]);
    expect(barPercents([])).toEqual([]);
  });

  it("сумма — большая целая без потери точности", () => {
    const big = 9_007_199_254_740_993_00n;
    expect(barPercents([big, big / 2n])).toEqual([100, 50]);
  });

  const items = [
    { label: "Сен", name: "Сентябрь 2026", value: 0n },
    { label: "Окт", name: "Октябрь 2026", value: 8_000_000n },
    { label: "Ноя", name: "Ноябрь 2026", value: 10_000_000n, current: true },
  ];

  it("рисунок скрыт от диктора, суммы через Money, текущий месяц — accent, остальные нейтральные", () => {
    const out = html(<Bars label="Выплаты по месяцам" items={items} />);
    expect(out).toMatch(/<ul aria-hidden="true"/);
    expect(count(out, "bg-accent")).toBe(1);
    expect(count(out, "bg-line-strong")).toBe(2);
    expect(out).toContain(`100${NB}000${NB}₸`);
    expect(out).toContain(`80${NB}000${NB}₸`);
    expect(out).toContain("--bar:100%");
    expect(out).toContain("--bar:80%");
    expect(out).toContain("--bar:0%");
  });

  it("раскладка: по умолчанию строки; columns — столбики на компьютере", () => {
    const rows = html(<Bars label="x" items={items} />);
    expect(rows).not.toContain("desktop:flex-row");
    expect(rows).not.toContain("desktop:bar-fill-v");
    const cols = html(<Bars label="x" items={items} layout="columns" />);
    expect(cols).toContain("desktop:flex-row");
    expect(cols).toContain("desktop:bar-fill-v");
  });

  it("таблица-дубль: подпись, заголовки, строка на месяц, текущий помечен", () => {
    const out = html(<Bars label="Выплаты по месяцам" items={items} />);
    const table = out.slice(out.indexOf("<table"));
    expect(table).toContain("<caption>Выплаты по месяцам</caption>");
    expect(table).toContain(`>${ru.app.kit.bars.month}</th>`);
    expect(table).toContain(`>${ru.app.kit.bars.amount}</th>`);
    expect(count(table, "<tr")).toBe(4);
    expect(table).toContain(`Ноябрь 2026, ${ru.app.kit.bars.current}`);
    expect(table).not.toContain(`Октябрь 2026, ${ru.app.kit.bars.current}`);
    expect(hasClass(table.slice(0, 40), "sr-only")).toBe(true);
  });

  it("без имени подпись столбика идёт в таблицу", () => {
    const out = html(<Bars label="x" items={[{ label: "Ноя", value: 1n }]} />);
    expect(out).toContain("<th scope=\"row\">Ноя</th>");
  });
});

describe("Uploader: камера и PDF", () => {
  const items = [{ id: "1", name: "a.jpg", state: "done" }] as const;

  it("без capture — как раньше: один input, кнопки камеры нет", () => {
    const out = html(<Uploader items={items} onAdd={noop} onRemove={noop} max={5} />);
    expect(count(out, 'type="file"')).toBe(1);
    expect(out).not.toContain(ru.app.kit.uploader.camera);
    expect(out).not.toContain("capture");
  });

  it("с capture: кнопка «Снять на камеру» только на телефоне, свой input с capture и только изображениями", () => {
    const out = html(<Uploader items={items} onAdd={noop} onRemove={noop} max={5} accept="image/*,application/pdf" capture="environment" />);
    expect(out).toContain(ru.app.kit.uploader.camera);
    expect(out).toMatch(/<button[^>]*desktop:hidden[^>]*>[\s\S]*Снять на камеру/);
    expect(count(out, 'type="file"')).toBe(2);
    expect(out).toMatch(/<input[^>]*accept="image\/\*"[^>]*capture="environment"|<input[^>]*capture="environment"[^>]*accept="image\/\*"/);
    expect(out).toContain('accept="image/*,application/pdf"');
  });

  it("при заполнении камера отключена", () => {
    const out = html(<Uploader items={items} onAdd={noop} onRemove={noop} max={1} capture="environment" />);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Снять на камеру/);
  });

  it("документ: значок и имя файла вместо превью, без img", () => {
    const out = html(
      <Uploader
        items={[
          { id: "1", name: "Устав.pdf", state: "done", kind: "document" },
          { id: "2", name: "Фото.jpg", state: "done", previewUrl: "blob:x" },
        ]}
        onAdd={noop}
        onRemove={noop}
        max={4}
        accept="image/*,application/pdf"
      />,
    );
    expect(out).toContain("Устав.pdf");
    expect(count(out, "<img")).toBe(1);
    expect(out).toContain(`aria-label="Убрать: Устав.pdf"`);
  });
});
