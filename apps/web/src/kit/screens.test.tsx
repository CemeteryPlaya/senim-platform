import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  Chips,
  CodeField,
  Columns,
  FilterList,
  List,
  ListRow,
  TextLink,
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

  it("цифровая клавиатура, одноразовый код, запас под вставку с пробелом (длина × 2)", () => {
    expect(hasAttr(tag, "inputmode", "numeric")).toBe(true);
    expect(hasAttr(tag, "autocomplete", "one-time-code")).toBe(true);
    expect(hasAttr(tag, "maxlength", "12")).toBe(true);
    expect(tag).not.toMatch(/pattern=/);
  });

  it("длина задаётся", () => {
    expect(hasAttr(inputTag(html(<CodeField label="Код" name="c" length={4} />), "c"), "maxlength", "8")).toBe(true);
  });

  it("ширина под код (max-w-code, токен), а не вся форма", () => {
    expect(hasClass(out, "max-w-code")).toBe(true);
    expect(readFileSync(path.join(__dirname, "tokens.css"), "utf8")).toMatch(/--spacing-code:\s*10rem\s*;/);
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

  it("телефон: 48 px, лента прокручивается и выходит за поля экрана; компьютер: 36 px и перенос", () => {
    expect(hasClass(out, "min-h-control")).toBe(true);
    expect(hasClass(out, "desktop:min-h-control-sm")).toBe(true);
    expect(hasClass(out, "overflow-x-auto")).toBe(true);
    expect(hasClass(out, "mobile:rail-bleed")).toBe(true);
    expect(hasClass(out, "desktop:flex-wrap")).toBe(true);
    expect(hasClass(out, "desktop:overflow-visible")).toBe(true);
  });

  it("без обводок: обычный — заливка fill и ink, выбранный — заливка action и on-action; капсула", () => {
    const chip = (label: string) => new RegExp(`<a [^>]*class="([^"]*)"[^>]*>${label}</a>`).exec(out)?.[1] ?? "";
    const plain = chip("Все");
    const active = chip("Кухни");
    for (const cls of ["bg-fill", "text-ink", "rounded-chip"]) expect(hasClass(`class="${plain}"`, cls), cls).toBe(true);
    for (const cls of ["bg-action", "text-on-action", "font-semibold", "rounded-chip"]) expect(hasClass(`class="${active}"`, cls), cls).toBe(true);
    expect(out).not.toMatch(/border/);
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

  it("нечисловые и нецелые значения: NaN и Infinity — ничего, дробные округляются, номер ограничивается", () => {
    const render = (page: number, pageCount: number) => html(<Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} label="Страницы" />);
    expect(render(Number.NaN, 5)).toBe("");
    expect(render(2, Number.NaN)).toBe("");
    expect(render(1, Number.POSITIVE_INFINITY)).toBe("");
    expect(render(1, 1.9)).toBe("");
    expect(text(<Pagination page={2.7} pageCount={5.9} hrefFor={hrefFor} label="Страницы" />)).toContain("Страница 2 из 5");
    expect(text(<Pagination page={0} pageCount={5} hrefFor={hrefFor} label="Страницы" />)).toContain("Страница 1 из 5");
    expect(text(<Pagination page={-3} pageCount={5} hrefFor={hrefFor} label="Страницы" />)).toContain("Страница 1 из 5");
    expect(text(<Pagination page={9} pageCount={5} hrefFor={hrefFor} label="Страницы" />)).toContain("Страница 5 из 5");
  });

  it("на краю соседней страницы нет и кнопки нет вовсе: ни ссылки, ни серого текста", () => {
    const first = html(<Pagination page={1} pageCount={3} hrefFor={hrefFor} label="Страницы" />);
    expect(count(first, "<a ")).toBe(1);
    expect(first).not.toContain("Назад");
    expect(first).not.toContain("<span");
    expect(first).toContain('href="/v2/masters?page=2"');
    const last = html(<Pagination page={3} pageCount={3} hrefFor={hrefFor} label="Страницы" />);
    expect(count(last, "<a ")).toBe(1);
    expect(last).not.toContain("Вперёд");
    expect(last).toContain('href="/v2/masters?page=2"');
  });

  it("компьютер: компактная группа по центру, тихие кнопки 36 px; телефон: кнопки 48 px, серые, делят строку", () => {
    const out = html(<Pagination page={2} pageCount={5} hrefFor={hrefFor} label="Страницы" />);
    expect(hasClass(out, "desktop:justify-center")).toBe(true);
    expect(hasClass(out, "desktop:min-h-control-sm")).toBe(true);
    expect(hasClass(out, "min-h-control")).toBe(true);
    expect(hasClass(out, "bg-transparent")).toBe(true);
    expect(hasClass(out, "mobile:bg-fill")).toBe(true);
    expect(hasClass(out, "flex-1")).toBe(true);
    expect(hasClass(out, "desktop:flex-none")).toBe(true);
  });
});

describe("Rating", () => {
  it("оценка и число отзывов текстом", () => {
    expect(text(<Rating value={4.8} count={12} />)).toBe("4,8 · 12 отзывов");
    expect(text(<Rating value={5} count={1} />)).toBe("5,0 · 1 отзыв");
    expect(text(<Rating value={4.5} count={3} />)).toBe("4,5 · 3 отзыва");
    expect(text(<Rating value={4.2} count={11} />)).toBe("4,2 · 11 отзывов");
    expect(text(<Rating value={4.2} count={21} />)).toBe("4,2 · 21 отзыв");
    expect(text(<Rating value={4.2} count={22} />)).toBe("4,2 · 22 отзыва");
    expect(text(<Rating value={4.2} count={111} />)).toBe("4,2 · 111 отзывов");
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
  it("media=slot без фото: нет <img, заглушка 4/3 с радиусом поля на месте, шеврона нет", () => {
    const out = html(<WorkCard href="/v2/masters/1" title="Кухня" meta="Алматы" media="slot" />);
    expect(out).not.toContain("<img");
    expect(hasClass(out, "aspect-4/3")).toBe(true);
    expect(hasClass(out, "rounded-field")).toBe(true);
    expect(out).not.toContain("lucide-chevron-right");
  });

  it("media=none (по умолчанию): нет области фото и <img даже при photo; на телефоне шеврон 20 px, скрытый от диктора", () => {
    for (const out of [
      html(<WorkCard href="/v2/x" title="Кухня" meta="Алматы" photo={{ src: "/f/1.jpg", alt: "Кухня" }} />),
      html(<WorkCard href="/v2/x" title="Кухня" meta="Алматы" media="none" />),
    ]) {
      expect(out).not.toContain("<img");
      expect(out).not.toContain("aspect-");
      expect(out).toMatch(/<svg[^>]*class="[^"]*lucide-chevron-right[^"]*size-5[^"]*desktop:hidden[^"]*"[^>]*aria-hidden="true"/);
    }
  });

  it("строки: заголовок, meta, byline muted 15 px, цена «от» с весом 500 прижата к низу", () => {
    const out = html(<WorkCard href="/v2/x" title="Кухня" meta="Алматы" byline="Мастер № 1042 · 48 сделок" priceFrom={85000000n} />);
    // Телефон: «meta · byline» одной строкой (разделитель виден только там); компьютер: отдельные строки.
    expect(out).toMatch(/<span class="desktop:block">Алматы<\/span><span aria-hidden="true" class="desktop:hidden"> · <\/span><span class="desktop:block">Мастер № 1042 · 48 сделок<\/span>/);
    expect(text(<WorkCard href="/v2/x" title="К" meta="Алматы" byline="Мастер" />)).toContain("Алматы · Мастер");
    const price = /<p class="([^"]*)">от/.exec(out)?.[1] ?? "";
    for (const cls of ["desktop:mt-auto", "font-medium", "text-body", "shrink-0"]) expect(hasClass(`class="${price}"`, cls), cls).toBe(true);
    // Строка с текстом и ценой: на телефоне в ряд (цена справа), на компьютере растворяется — цена внизу колонки.
    expect(hasClass(out, "mobile:flex")).toBe(true);
    expect(hasClass(out, "desktop:contents")).toBe(true);
    expect(hasClass(out, "mobile:py-3")).toBe(true);
    expect(hasClass(html(<WorkCard href="/v2/x" title="К" meta="М" media="slot" />), "mobile:py-3")).toBe(false);
    expect(hasClass(out, "tabular-nums")).toBe(true);
    expect(hasClass(out, "h-full")).toBe(true);
    expect(html(<WorkCard href="/v2/x" title="Кухня" meta="Алматы" />)).not.toContain("1042");
  });

  it("с фото (media=slot) — img с alt; заголовок, строка meta, цена «от»", () => {
    const el = <WorkCard href="/v2/masters/1" title="Кухня" meta="Алматы" media="slot" priceFrom={122400000n} photo={{ src: "/f/1.jpg", alt: "Кухня с островом" }} />;
    const out = html(el);
    expect(out).toContain('src="/f/1.jpg"');
    expect(out).toContain('alt="Кухня с островом"');
    expect(out).toContain('href="/v2/masters/1"');
    expect(text(el)).toContain(`от ${formatMoney(122400000n)}`);
    expect(out).toMatch(/<h3[^>]*><a [^>]*>Кухня<\/a><\/h3>/);
    expect(html(<WorkCard href="/v2/x" title="Кухня" meta="М" headingLevel={2} />)).toMatch(/<h2[^>]*><a [^>]*>Кухня<\/a><\/h2>/);
    expect(html(<WorkCard href="/v2/x" title="Кухня" meta="М" headingLevel={2} />)).not.toContain("<h3");
  });

  it("кликабельна вся карточка: одна ссылка растянута на карточку, вложенных интерактивных нет", () => {
    const out = html(<WorkCard href="/v2/masters/1" title="Кухня" meta="Алматы" priceFrom={1000n} />);
    expect(count(out, "<a ")).toBe(1);
    expect(count(out, "<button")).toBe(0);
    expect(hasClass(out, "after:absolute")).toBe(true);
    expect(hasClass(out, "after:inset-0")).toBe(true);
    expect(hasClass(out, "relative")).toBe(true);
    expect(hasClass(out, "has-focus-visible:outline-2")).toBe(true);
  });

  it("без цены строки «от» нет", () => {
    expect(text(<WorkCard href="/v2/x" title="Кухня" meta="Алматы" />)).not.toContain("от");
  });
});

describe("RadioCard: описание", () => {
  const out = html(<RadioCard label="По SMS" description="Придёт за минуту" name="ch" value="sms" />);

  it("вторая строка 15 px muted под подписью; радио связано с ней через aria-describedby", () => {
    expect(out).toMatch(/<span id="([^"]+)-description" class="text-sub text-muted">Придёт за минуту<\/span>/);
    const id = /<span id="([^"]+)-description"/.exec(out)?.[1];
    expect(out).toContain(`aria-describedby="${id}-description"`);
    expect(hasClass(out, "min-h-control")).toBe(true);
  });

  it("имя радио — только подпись (aria-labelledby на span подписи), описание — только describedby", () => {
    const id = /<span id="([^"]+)-label">По SMS<\/span>/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`aria-labelledby="${id}-label"`);
    expect(out).toContain(`aria-describedby="${id}-description"`);
    expect(out).not.toContain(`aria-labelledby="${id}-description"`);
  });

  it("без описания разметка прежняя: подпись одним span, aria-describedby нет", () => {
    const plain = html(<RadioCard label="По SMS" name="ch" value="sms" />);
    expect(plain).not.toContain("aria-describedby");
    expect(plain).not.toContain("aria-labelledby");
    expect(plain).not.toContain("-description");
    expect(plain).toContain("<span>По SMS</span></label>");
  });
});

describe("ActionDock", () => {
  const out = html(
    <ActionDock>
      <span>x</span>
    </ActionDock>,
  );

  it("на коротком экране уходит к низу колонки: mobile:mt-auto", () => {
    expect(hasClass(out, "mobile:mt-auto")).toBe(true);
  });

  it("на телефоне прилипает над панелью вкладок; без плиты: ни стекла, ни подложки — кнопка с тенью float", () => {
    expect(hasClass(out, "mobile:sticky")).toBe(true);
    expect(hasClass(out, "mobile:dock-above-bar")).toBe(true);
    expect(hasClass(out, "mobile:dock-float")).toBe(true);
    expect(out).not.toMatch(/glass-|bg-surface|bg-raised|rounded-card/);
  });

  it("док сам задаёт ширину детей: на телефоне на всю ширину, на компьютере по своей в ряд", () => {
    expect(out).toContain("mobile:*:w-full");
    expect(out).toContain("desktop:*:w-auto");
    expect(hasClass(out, "flex-col")).toBe(true);
    expect(hasClass(out, "desktop:flex-row")).toBe(true);
    expect(hasClass(out, "desktop:flex-wrap")).toBe(true);
    expect(hasClass(out, "desktop:items-center")).toBe(true);
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

describe("FilterList", () => {
  const out = html(
    <FilterList
      title="Тип мебели"
      items={[
        { href: "/v2/catalog", label: "Все", active: false },
        { href: "/v2/catalog?type=kitchen", label: "Кухни", active: true },
      ]}
    />,
  );

  it("навигация с именем-заголовком; активная — aria-current и галочка справа", () => {
    expect(out).toContain('<nav aria-label="Тип мебели"');
    expect(out).toMatch(/<p class="[^"]*font-semibold[^"]*">Тип мебели<\/p>/);
    expect(count(out, "aria-current")).toBe(1);
    expect(out).toMatch(/<a [^>]*aria-current="true"[^>]*>.*Кухни.*lucide-check/);
    expect(count(out, "lucide-check")).toBe(1);
  });

  it("строки 48 px на телефоне и 36 px на компьютере; активная — вес 600", () => {
    expect(hasClass(out, "min-h-control")).toBe(true);
    expect(hasClass(out, "desktop:min-h-control-sm")).toBe(true);
    expect(hasClass(out, "min-h-control-sm")).toBe(false);
    expect(hasClass(/<a [^>]*aria-current="true"[^>]*>/.exec(out)?.[0] ?? "", "font-semibold")).toBe(true);
  });
});

describe("Columns", () => {
  it("компьютер — count равных колонок с зазором группы и растяжением; телефон — одна колонка", () => {
    const three = html(<Columns count={3}><p>a</p></Columns>);
    expect(hasClass(three, "desktop:grid-cols-3")).toBe(true);
    expect(hasClass(three, "desktop:grid")).toBe(true);
    expect(hasClass(three, "desktop:items-stretch")).toBe(true);
    expect(hasClass(three, "gap-stack-group")).toBe(true);
    expect(hasClass(three, "flex-col")).toBe(true);
    expect(hasClass(html(<Columns count={2}><p>a</p></Columns>), "desktop:grid-cols-2")).toBe(true);
  });
});

describe("TextLink", () => {
  const out = html(<TextLink href="/v2/login?role=executor">Я мастер</TextLink>);

  it("ссылка с текстом и шевроном 16 px, скрытым от диктора", () => {
    expect(out).toMatch(/<a [^>]*href="\/v2\/login\?role=executor"[^>]*>Я мастер<svg/);
    expect(out).toMatch(/<svg[^>]*class="[^"]*size-4[^"]*"[^>]*aria-hidden="true"/);
  });

  it("ink, вес 500, 48 px; без боковых отступов и отрицательных полей; наведение — подчёркивание", () => {
    for (const cls of ["text-ink", "font-medium", "min-h-control", "hover:underline", "no-underline"]) expect(hasClass(out, cls), cls).toBe(true);
    expect(out).not.toMatch(/class="[^"]*\b-?(?:px|pl|pr|ml|mr|mx)-/);
  });
});

describe("TextLink external", () => {
  const out = html(
    <TextLink href="/api/documents/d1/pdf" external>
      Открыть оферту
    </TextLink>,
  );

  it("обычная ссылка в новой вкладке: target=_blank, rel=noopener noreferrer, без предзагрузки роутера", () => {
    expect(out).toMatch(/^<a href="\/api\/documents\/d1\/pdf" target="_blank" rel="noopener noreferrer"/);
  });

  it("значок внешней ссылки вместо шеврона; для диктора — «откроется в новой вкладке»", () => {
    expect(out).toContain("lucide-external-link");
    expect(out).not.toContain("lucide-chevron-right");
    expect(out).toMatch(/Открыть оферту<span class="sr-only"> \(откроется в новой вкладке\)<\/span><svg/);
  });

  it("вид тот же, что у внутренней ссылки", () => {
    for (const cls of ["text-ink", "font-medium", "min-h-control", "hover:underline", "no-underline"]) expect(hasClass(out, cls), cls).toBe(true);
  });
});

describe("ListRow: шеврон", () => {
  const row = (chevron?: boolean) =>
    html(
      <List>
        <ListRow label="Деньги" href="/v2/about#money" chevron={chevron} />
      </List>,
    );

  it("по умолчанию у ссылки есть шеврон; chevron=false — только ссылка", () => {
    expect(row()).toContain("lucide-chevron-right");
    expect(row(true)).toContain("lucide-chevron-right");
    const none = row(false);
    expect(none).not.toContain("lucide-chevron-right");
    expect(none).toContain('href="/v2/about#money"');
  });
});

describe("WorkCard без href", () => {
  const out = html(<WorkCard title="Кухня" meta="Алматы" byline="Мастер" priceFrom={1000n} />);

  it("неинтерактивна: нет ссылки, шеврона, отклика на нажатие и кольца фокуса; разметка текста та же", () => {
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("lucide-chevron-right");
    expect(out).not.toContain("pressable");
    expect(out).not.toContain("has-focus-visible");
    expect(out).not.toContain("after:absolute");
    expect(out).toMatch(/<h3 class="text-headline text-ink">Кухня<\/h3>/);
    expect(text(<WorkCard title="Кухня" meta="Алматы" byline="Мастер" priceFrom={1000n} />)).toContain("Алматы · Мастер");
  });

  it("с href всё это есть", () => {
    const linked = html(<WorkCard href="/v2/x" title="Кухня" meta="Алматы" />);
    expect(linked).toContain("<a ");
    expect(linked).toContain("lucide-chevron-right");
    expect(hasClass(linked, "pressable")).toBe(true);
  });
});

describe("ListRow: цвета и stacked", () => {
  const row = (props: Parameters<typeof ListRow>[0]) => html(<List><ListRow {...props} /></List>);

  it("обычная строка: подпись muted слева, значение ink справа", () => {
    const out = row({ label: "Срок", value: "до 28 ноября" });
    expect(out).toMatch(/<span class="[^"]*text-muted[^"]*">Срок<\/span>/);
    expect(out).toMatch(/<span class="[^"]*text-ink[^"]*"><span>до 28 ноября<\/span>/);
  });

  it("строка без значения (ссылка): подпись ink", () => {
    expect(row({ label: "О сервисе", href: "/v2/about" })).toMatch(/<span class="[^"]*text-ink[^"]*">О сервисе<\/span>/);
  });

  it("stacked: подпись text-sub muted над значением text-body ink, значение переносится", () => {
    const out = row({ label: "Адрес", value: "Астана, ул. Кенесары, 40", stacked: true });
    expect(out).toMatch(/<span class="text-sub text-muted">Адрес<\/span><span class="text-body wrap-break-word text-ink">Астана, ул. Кенесары, 40<\/span>/);
    expect(hasClass(out, "flex-col")).toBe(true);
  });

  it("Rating — значение строки без <p> внутри <span>", () => {
    const out = row({ label: "Оценка", value: <Rating value={4.8} count={12} /> });
    expect(out).not.toContain("<p");
    expect(out).toContain('<span class="text-body text-ink">4,8 · 12 отзывов</span>');
    expect(row({ label: "Оценка", value: <Rating value={null} count={0} /> })).toContain('<span class="text-body text-muted">Пока без отзывов</span>');
  });
});
