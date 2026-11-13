import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  Chips,
  CodeField,
  formatMoney,
  HiddenField,
  Notice,
  Pagination,
  PhoneField,
  Rating,
  RadioCard,
  WorkCard,
} from "@/kit";
import { count, hasClass, html, text } from "@/kit/test-utils";

/** Атрибут тега `<input>` с заданным `name` (тег один на разметку). */
function inputTag(out: string, name: string): string {
  const tag = new RegExp(`<input[^>]*\\sname="${name}"[^>]*>`).exec(out)?.[0];
  if (!tag) throw new Error(`нет <input name="${name}"> в ${out}`);
  return tag;
}

/** Тег содержит атрибут `name="value"`; регистр имени не важен (HTML), React пишет `inputMode`, `maxLength`. */
const hasAttr = (tag: string, attr: string, value: string): boolean => new RegExp(String.raw`\s${attr}="${value}"`, "i").test(tag);

describe("Notice", () => {
  it("live → role=alert; без live роли нет", () => {
    expect(html(<Notice tone="warn" live>x</Notice>)).toContain('role="alert"');
    expect(html(<Notice tone="warn">x</Notice>)).not.toContain("role=");
  });

  it("тон задаёт пару цветов, заголовок и текст выводятся", () => {
    const out = html(
      <Notice tone="danger" title="Заголовок">
        Текст
      </Notice>,
    );
    expect(hasClass(out, "bg-danger-soft")).toBe(true);
    expect(hasClass(out, "text-danger")).toBe(true);
    expect(text(<Notice tone="info" title="Т">Б</Notice>)).toBe("ТБ");
    expect(hasClass(html(<Notice tone="info">x</Notice>), "bg-accent-soft")).toBe(true);
    expect(hasClass(html(<Notice tone="warn">x</Notice>), "bg-warn-soft")).toBe(true);
  });
});

describe("HiddenField", () => {
  it("скрытый input с именем и значением", () => {
    const tag = inputTag(html(<HiddenField name="next" value="/v2/deals" />), "next");
    expect(tag).toContain('type="hidden"');
    expect(tag).toContain('value="/v2/deals"');
  });
});

describe("CodeField", () => {
  const out = html(<CodeField label="Код" name="code" />);
  const tag = inputTag(out, "code");

  it("цифровая клавиатура, одноразовый код, шесть знаков", () => {
    expect(hasAttr(tag, "inputmode", "numeric")).toBe(true);
    expect(hasAttr(tag, "autocomplete", "one-time-code")).toBe(true);
    expect(hasAttr(tag, "maxlength", "6")).toBe(true);
  });

  it("длина задаётся", () => {
    expect(hasAttr(inputTag(html(<CodeField label="Код" name="c" length={4} />), "c"), "maxlength", "4")).toBe(true);
  });

  it("цифры одной ширины с разрядкой; подпись связана с полем", () => {
    expect(hasClass(out, "tabular-nums")).toBe(true);
    expect(hasClass(out, "tracking-code")).toBe(true);
    expect(out).toMatch(/<label for="([^"]+)"[^>]*>Код<\/label>/);
  });

  it("ошибка связана с полем", () => {
    const withError = html(<CodeField label="Код" name="code" error="Не подошёл" />);
    expect(withError).toContain('aria-invalid="true"');
    expect(withError).toContain("Не подошёл");
  });
});

describe("PhoneField", () => {
  const out = html(<PhoneField label="Телефон" name="phone" defaultValue="+77001234567" />);
  const tag = inputTag(out, "phone");

  it("type=tel, автозаполнение tel, значение по умолчанию", () => {
    expect(tag).toContain('type="tel"');
    expect(hasAttr(tag, "autocomplete", "tel")).toBe(true);
    expect(tag).toContain('value="+77001234567"');
  });

  it("подсказка формата из ru", () => {
    expect(tag).toContain(`placeholder="${ru.app.kit.fields.phonePlaceholder}"`);
  });
});

describe("Chips", () => {
  const items = [
    { href: "/v2/masters", label: "Все", active: false },
    { href: "/v2/masters?c=kitchen", label: "Кухни", active: true },
  ];
  const out = html(<Chips items={items} label="Категории" />);

  it("навигация с именем; активный — aria-current, остальные нет", () => {
    expect(out).toContain('<nav aria-label="Категории"');
    expect(count(out, "aria-current")).toBe(1);
    expect(out).toMatch(/<a [^>]*aria-current="true"[^>]*>Кухни<\/a>/);
    expect(out).toMatch(/<a [^>]*href="\/v2\/masters"[^>]*>Все<\/a>/);
  });

  it("цель касания не ниже 48 px и строка прокручивается вбок", () => {
    expect(hasClass(out, "min-h-control")).toBe(true);
    expect(hasClass(out, "overflow-x-auto")).toBe(true);
  });
});

describe("Pagination", () => {
  const hrefFor = (n: number) => `/v2/masters?page=${n}`;

  it("одна страница и меньше — ничего", () => {
    expect(html(<Pagination page={1} pageCount={1} hrefFor={hrefFor} label="Страницы" />)).toBe("");
    expect(html(<Pagination page={1} pageCount={0} hrefFor={hrefFor} label="Страницы" />)).toBe("");
  });

  it("страница 2 из 5: ссылки на 1 и 3 и текст", () => {
    const el = <Pagination page={2} pageCount={5} hrefFor={hrefFor} label="Страницы" />;
    const out = html(el);
    expect(out).toContain('href="/v2/masters?page=1"');
    expect(out).toContain('href="/v2/masters?page=3"');
    expect(out).toContain('aria-label="Страницы"');
    expect(text(el)).toContain("Страница 2 из 5");
    expect(count(out, "<a ")).toBe(2);
  });

  it("на краю соседней страницы нет: вместо ссылки приглушённый блок", () => {
    const first = html(<Pagination page={1} pageCount={3} hrefFor={hrefFor} label="Страницы" />);
    expect(count(first, "<a ")).toBe(1);
    expect(first).toContain('aria-disabled="true"');
    expect(first).toContain('href="/v2/masters?page=2"');
    const last = html(<Pagination page={3} pageCount={3} hrefFor={hrefFor} label="Страницы" />);
    expect(count(last, "<a ")).toBe(1);
    expect(last).toContain('href="/v2/masters?page=2"');
  });
});

describe("Rating", () => {
  it("оценка и число отзывов текстом", () => {
    expect(text(<Rating value={4.8} count={12} />)).toBe("4,8 · 12 отзывов");
    expect(text(<Rating value={5} count={1} />)).toBe("5,0 · 1 отзыв");
    expect(text(<Rating value={4.5} count={3} />)).toBe("4,5 · 3 отзыва");
    expect(text(<Rating value={4.2} count={11} />)).toBe("4,2 · 11 отзывов");
  });

  it("без оценки — «Пока без отзывов»", () => {
    expect(text(<Rating value={null} count={0} />)).toBe("Пока без отзывов");
    expect(text(<Rating value={4.8} count={0} />)).toBe("Пока без отзывов");
  });

  it("нет звёзд-иконок", () => {
    expect(html(<Rating value={4.8} count={12} />)).not.toContain("<svg");
  });
});

describe("WorkCard", () => {
  it("без фото нет <img, заглушка 4/3 на месте", () => {
    const out = html(<WorkCard href="/v2/masters/1" title="Кухня" meta="Алматы" />);
    expect(out).not.toContain("<img");
    expect(hasClass(out, "aspect-4/3")).toBe(true);
  });

  it("с фото — img с alt; заголовок, строка meta, цена «от»", () => {
    const el = <WorkCard href="/v2/masters/1" title="Кухня" meta="Алматы" priceFrom={122400000n} photo={{ src: "/f/1.jpg", alt: "Кухня с островом" }} />;
    const out = html(el);
    expect(out).toContain('src="/f/1.jpg"');
    expect(out).toContain('alt="Кухня с островом"');
    expect(out).toContain('href="/v2/masters/1"');
    expect(text(el)).toContain(`от ${formatMoney(122400000n)}`);
    expect(out).toMatch(/<h3[^>]*>Кухня<\/h3>/);
  });

  it("без цены строки «от» нет", () => {
    expect(text(<WorkCard href="/v2/x" title="Кухня" meta="Алматы" />)).not.toContain("от");
  });
});

describe("ActionDock", () => {
  const out = html(
    <ActionDock>
      <span>x</span>
    </ActionDock>,
  );

  it("на телефоне прилипает над панелью вкладок", () => {
    expect(hasClass(out, "mobile:sticky")).toBe(true);
    expect(hasClass(out, "mobile:dock-above-bar")).toBe(true);
    expect(hasClass(out, "mobile:glass")).toBe(true);
  });

  it("на компьютере без прилипания: нет sticky без mobile:, нет fixed", () => {
    expect(hasClass(out, "sticky")).toBe(false);
    expect(hasClass(out, "fixed")).toBe(false);
  });
});

describe("радио в forced-colors", () => {
  const css = readFileSync(path.join(__dirname, "tokens.css"), "utf8");

  it("утилита radio-mark есть и работает в forced-colors: active", () => {
    const body = /@utility radio-mark\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(body).toContain("@media (forced-colors: active)");
    expect(body).toContain("Highlight");
  });

  it("RadioCard применяет её к точке выбора", () => {
    expect(html(<RadioCard label="А" name="a" value="a" />)).toMatch(/class="[^"]*\bradio-mark\b/);
  });
});
