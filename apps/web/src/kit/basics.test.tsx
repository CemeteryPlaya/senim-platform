import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BackLink,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  List,
  ListRow,
  Money,
  PageTitle,
  PhotoSlot,
  Progress,
  RadioCard,
  RadioGroup,
  Select,
  Skeleton,
  StatusChip,
  TextArea,
  TextField,
} from "./index";
import { hasClass, html, text } from "./test-utils";

const NB = " ";
const describedByPair = /aria-describedby="([^"]+)"[\s\S]*id="\1"|id="([^"]+)"[\s\S]*aria-describedby="\2"/;
describe("Button", () => {
  it("primary по умолчанию ставит data-primary-action, остальные варианты нет", () => {
    expect(html(<Button>Ок</Button>)).toContain("data-primary-action");
    expect(html(<Button variant="secondary">Ок</Button>)).not.toContain("data-primary-action");
    expect(html(<Button variant="quiet">Ок</Button>)).not.toContain("data-primary-action");
    expect(html(<Button variant="danger">Ок</Button>)).not.toContain("data-primary-action");
  });

  it("flush у тихой кнопки: без боковых отступов, высота касания прежняя, наведение — подчёркивание; у других вариантов не действует", () => {
    for (const size of ["md", "sm"] as const) {
      const flat = html(
        <Button variant="quiet" size={size} flush>
          Ок
        </Button>,
      );
      expect(hasClass(flat, "px-6") || hasClass(flat, "px-4")).toBe(false);
      expect(hasClass(flat, "min-h-control")).toBe(true);
      expect(hasClass(flat, "hover:not-disabled:underline")).toBe(true);
      expect(hasClass(flat, "hover:not-disabled:bg-fill")).toBe(false);
    }
    expect(hasClass(html(<Button variant="quiet">Ок</Button>), "px-6")).toBe(true);
    expect(hasClass(html(<Button variant="quiet" size="sm">Ок</Button>), "px-4")).toBe(true);
    expect(
      hasClass(
        html(
          <Button variant="secondary" flush>
            Ок
          </Button>,
        ),
        "px-6",
      ),
    ).toBe(true);
  });

  it("pending: aria-disabled и aria-busy, без нативного disabled (фокус не теряется)", () => {
    const out = html(<Button pending>Ок</Button>);
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('aria-busy="true"');
    expect(out).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(out).toContain("<svg");
  });

  it("pending сохраняет подпись в доступном имени и добавляет «подождите»", () => {
    const out = html(<Button pending>Принять мебель</Button>);
    expect(out).toContain("Принять мебель");
    expect(out).toContain(", подождите");
    expect(out).not.toContain("invisible");
  });

  it("pending не откликается на наведение и нажатие, обычная — откликается (кроме отключённой)", () => {
    const busy = html(<Button pending>Ок</Button>);
    expect(busy).not.toContain("hover:");
    expect(hasClass(busy, "pressable")).toBe(false);
    const idle = html(<Button>Ок</Button>);
    // Наведение главной — осветление (bg-action-hover), а не прозрачность.
    expect(hasClass(idle, "hover:not-disabled:bg-action-hover")).toBe(true);
    expect(idle).not.toMatch(/hover:[^\s"]*opacity-/);
    expect(hasClass(idle, "pressable")).toBe(true);
  });

  it("обычная кнопка без aria-disabled, aria-busy и disabled", () => {
    const out = html(<Button>Ок</Button>);
    expect(out).not.toMatch(/\saria-disabled=/);
    expect(out).not.toMatch(/\saria-busy=/);
    expect(out).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });

  it("явный disabled остаётся нативным", () => {
    const out = html(<Button disabled>Ок</Button>);
    expect(out).toMatch(/\sdisabled(?:=|\s|>)/);
    expect(out).not.toContain('aria-disabled="true"');
  });

  it("по умолчанию type=button; submit передаётся", () => {
    expect(html(<Button>Ок</Button>)).toContain('type="button"');
    expect(html(<Button type="submit">Ок</Button>)).toContain('type="submit"');
  });

  it("размер md — 48 px; sm — база 48 px (доступная высота), 36 px только вариантом desktop:", () => {
    const md = html(<Button>Ок</Button>);
    expect(hasClass(md, "min-h-control")).toBe(true);
    expect(md).not.toContain("min-h-control-sm");
    const sm = html(<Button variant="secondary" size="sm">Ок</Button>);
    expect(hasClass(sm, "min-h-control")).toBe(true);
    expect(hasClass(sm, "desktop:min-h-control-sm")).toBe(true);
    expect(hasClass(sm, "min-h-control-sm")).toBe(false);
    expect(sm).not.toContain("mobile:");
  });

  it("главная кнопка бывает только размера md: sm для primary не собирается типом", () => {
    // @ts-expect-error — у главной кнопки размер только md (48 px), sm запрещён типом
    const implicit = <Button size="sm">Ок</Button>;
    // @ts-expect-error — и при явном variant="primary"
    const explicit = <Button variant="primary" size="sm">Ок</Button>;
    // @ts-expect-error — и у кнопки-ссылки
    const link = <ButtonLink href="/x" size="sm">Ок</ButtonLink>;
    expect([implicit, explicit, link]).toHaveLength(3);
    // Разрешённые сочетания собираются.
    const ok = [
      <Button key="a" size="md">Ок</Button>,
      <Button key="b" variant="quiet" size="sm">Ок</Button>,
      <ButtonLink key="c" href="/x" variant="danger" size="sm">Ок</ButtonLink>,
    ];
    expect(ok).toHaveLength(3);
  });

  it.each(["primary", "secondary", "quiet", "danger"] as const)(
    "%s: ожидание — полный цвет варианта и индикатор, без приглушения",
    (variant) => {
      const out = html(<Button variant={variant} pending>Ок</Button>);
      expect(out).toContain("<svg");
      const tag = out.match(/<button[^>]*>/)?.[0] ?? "";
      expect(tag).not.toMatch(/[\s":]opacity-\d/);
    },
  );

  it.each(["primary", "secondary", "quiet", "danger"] as const)(
    "%s: отключённая — без заливки, контур line, текст muted, без прозрачности (одинаково у всех вариантов)",
    (variant) => {
      const out = html(<Button variant={variant} disabled>Ок</Button>);
      for (const cls of ["disabled:bg-transparent", "disabled:ring-1", "disabled:ring-line", "disabled:text-muted"]) expect(hasClass(out, cls), cls).toBe(true);
      const tag = out.match(/<button[^>]*>/)?.[0] ?? "";
      expect(tag).not.toMatch(/[\s"](?:disabled:)?opacity-\d/);
    },
  );

  it("inverse — главная кнопка на тёмном фото: белая заливка, графитовый текст, метка главного действия, только md", () => {
    for (const out of [html(<Button variant="inverse">Заказать</Button>), html(<ButtonLink href="/x" variant="inverse">Заказать</ButtonLink>)]) {
      for (const cls of ["bg-on-photo", "text-on-inverse", "min-h-control", "pressable", "hover:not-disabled:bg-inverse-hover"]) {
        expect(hasClass(out, cls), cls).toBe(true);
      }
      expect(out).toContain("data-primary-action");
      // Наведение — затемнение, а не прозрачность: фото не проступает сквозь кнопку.
      expect(out).not.toMatch(/hover:[^\s"]*opacity-/);
    }
    // @ts-expect-error — у инверсной главной размер только md
    const small = <Button variant="inverse" size="sm">Ок</Button>;
    expect(small).toBeTruthy();
  });

  it("вторичная — заливка fill и текст ink; отключённая отличается от неё формой (без заливки, контур) и текстом muted", () => {
    const secondary = html(<Button variant="secondary">Ок</Button>);
    for (const cls of ["bg-fill", "text-ink", "hover:not-disabled:bg-fill-strong"]) expect(hasClass(secondary, cls), cls).toBe(true);
    expect(hasClass(secondary, "bg-line")).toBe(false);
    const disabled = html(<Button variant="secondary" disabled>Ок</Button>);
    for (const cls of ["disabled:text-muted", "disabled:bg-transparent", "disabled:ring-line"]) expect(hasClass(disabled, cls), cls).toBe(true);
  });

  it("full растягивает кнопку, без full — нет", () => {
    expect(hasClass(html(<Button full>Ок</Button>), "w-full")).toBe(true);
    expect(hasClass(html(<Button>Ок</Button>), "w-full")).toBe(false);
  });

  it("ButtonLink — ссылка с теми же метками", () => {
    const out = html(<ButtonLink href="/v2/deals">Сделки</ButtonLink>);
    expect(out).toMatch(/<a[^>]+href="\/v2\/deals"/);
    expect(out).toContain("data-primary-action");
    expect(html(<ButtonLink href="/x" variant="quiet">Ок</ButtonLink>)).not.toContain("data-primary-action");
  });
});

describe("Поля", () => {
  it("ошибка связана с полем, помечает его невалидным и озвучивается", () => {
    const f = html(<TextField label="Почта" name="email" error="Проверьте адрес" />);
    expect(f).toContain('aria-invalid="true"');
    expect(f).toMatch(describedByPair);
    expect(f).toContain("Проверьте адрес");
    expect(f).toContain('role="alert"');
  });

  it("без ошибки нет aria-invalid, aria-describedby и role=alert", () => {
    const f = html(<TextField label="Почта" name="email" />);
    expect(f).not.toContain("aria-invalid");
    expect(f).not.toContain("aria-describedby");
    expect(f).not.toContain('role="alert"');
    expect(f).toContain('name="email"');
  });

  it("свой aria-describedby не затирается: получает и свой id, и id ошибки", () => {
    const f = html(<TextField label="Почта" name="email" aria-describedby="hint" error="Ошибка" />);
    const value = /aria-describedby="([^"]+)"/.exec(f)?.[1] ?? "";
    const ids = value.split(" ");
    expect(ids).toContain("hint");
    expect(ids).toHaveLength(2);
    const errorId = ids.find((i) => i !== "hint") ?? "";
    expect(f).toContain(`id="${errorId}"`);
    expect(html(<TextField label="Почта" name="email" aria-describedby="hint" />)).toContain('aria-describedby="hint"');
  });

  it("подпись привязана к полю", () => {
    const f = html(<TextField label="Почта" name="email" />);
    expect(f).toMatch(/<label[^>]+for="([^"]+)"[\s\S]*<input[^>]+id="\1"/);
  });

  it("TextArea, Select и Checkbox тоже связывают ошибку и не теряют свой describedby", () => {
    expect(html(<TextArea label="Описание" name="d" error="Коротко" />)).toMatch(describedByPair);
    expect(
      html(
        <Select label="Город" name="c" error="Выберите">
          <option value="a">Астана</option>
        </Select>,
      ),
    ).toMatch(describedByPair);
    expect(html(<Checkbox label="Согласен" name="ok" error="Нужно согласие" />)).toMatch(describedByPair);
    expect(html(<Checkbox label="Согласен" name="ok" error="Нужно" />)).toContain('aria-invalid="true"');
    expect(html(<Checkbox label="Согласен" name="ok" error="Нужно" aria-describedby="h" />)).toMatch(/aria-describedby="h [^"]+"/);
  });

  it("RadioGroup: fieldset с legend, карточки внутри, общая ошибка связана с группой", () => {
    const out = html(
      <RadioGroup legend="Способ получения" error="Выберите способ">
        <RadioCard label="Самовывоз" name="m" value="a" />
        <RadioCard label="Доставка" name="m" value="b" />
      </RadioGroup>,
    );
    expect(out).toMatch(/^<fieldset/);
    expect(out).toMatch(/<legend[^>]*>Способ получения<\/legend>/);
    expect(out.match(/type="radio"/g)?.length).toBe(2);
    expect(out).toContain('role="alert"');
    expect(out.match(/Выберите способ/g)?.length).toBe(1);
    expect(out).toMatch(describedByPair);
  });

  it("RadioGroup legendHidden: legend в разметке, но только для диктора (sr-only); ошибка видна как прежде", () => {
    const legendOf = (out: string) => /<legend[^>]*>[^<]*<\/legend>/.exec(out)?.[0] ?? "";
    const hidden = html(
      <RadioGroup legend="Способ получения" error="Выберите способ" legendHidden>
        <RadioCard label="Самовывоз" name="m" value="a" />
      </RadioGroup>,
    );
    expect(legendOf(hidden)).toContain("Способ получения");
    expect(hasClass(legendOf(hidden), "sr-only")).toBe(true);
    expect(hidden).toContain('role="alert"');
    expect(hidden).toMatch(describedByPair);

    const visible = html(
      <RadioGroup legend="Способ получения">
        <RadioCard label="Самовывоз" name="m" value="a" />
      </RadioGroup>,
    );
    expect(hasClass(legendOf(visible), "sr-only")).toBe(false);
    expect(hasClass(legendOf(visible), "mb-2")).toBe(true);
    // Без пропа разметка прежняя.
    expect(
      html(
        <RadioGroup legend="Способ получения" legendHidden={false}>
          <RadioCard label="Самовывоз" name="m" value="a" />
        </RadioGroup>,
      ),
    ).toBe(visible);
  });

  it("RadioGroup без ошибки не рисует alert и describedby; у RadioCard нет своей ошибки", () => {
    const out = html(
      <RadioGroup legend="Способ">
        <RadioCard label="Самовывоз" name="m" value="a" />
      </RadioGroup>,
    );
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain("aria-describedby");
    expect(out).not.toContain("aria-invalid");
  });

  it("подписи полей и групп — 15 px / 500 (text-sub font-medium), одинаково в обеих версиях", () => {
    const outs = [
      html(<TextField label="Имя" name="a" />),
      html(<TextArea label="Описание" name="b" />),
      html(
        <Select label="Город" name="c">
          <option value="a">Астана</option>
        </Select>,
      ),
    ];
    for (const out of outs) {
      const label = out.match(/<label[^>]*>/)?.[0] ?? "";
      for (const cls of ["text-sub", "font-medium"]) expect(hasClass(label, cls), cls).toBe(true);
      expect(label).not.toMatch(/(?:desktop|mobile):/);
    }
    const legend = html(<RadioGroup legend="Способ">x</RadioGroup>).match(/<legend[^>]*>/)?.[0] ?? "";
    for (const cls of ["text-sub", "font-medium"]) expect(hasClass(legend, cls), cls).toBe(true);
  });

  it("Select: подсказка пустого выбора (option value=\"\") — muted, выбранное значение и список — ink", () => {
    const select = html(
      <Select label="Город" name="c" defaultValue="">
        <option value="" disabled>
          Выберите город
        </option>
        <option value="a">Астана</option>
      </Select>,
    ).match(/<select[^>]*>/)?.[0] ?? "";
    // React экранирует в атрибуте «&», «'» и «>».
    const attr = (cls: string) => cls.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/>/g, "&gt;");
    for (const cls of ["text-ink", "has-[option[value='']:checked]:text-muted", "[&>option]:text-ink"]) {
      expect(hasClass(select, attr(cls)), cls).toBe(true);
    }
  });

  it("TextArea: без уголка изменения размера, растёт по содержимому от трёх строк, запасной вариант — 4 строки", () => {
    const area = html(<TextArea label="Описание" name="d" />).match(/<textarea[^>]*>/)?.[0] ?? "";
    for (const cls of ["resize-none", "field-sizing-content", "min-h-area"]) expect(hasClass(area, cls), cls).toBe(true);
    expect(area).toContain('rows="4"');
  });

  it("RadioCard: радиокнопка в подписи, выбранная выделяется рамкой без ring", () => {
    const out = html(<RadioCard label="Самовывоз" name="m" value="a" />);
    expect(out).toContain('type="radio"');
    expect(out).toContain("has-checked:border-action");
    expect(out).not.toContain("ring");
  });
});

describe("Money", () => {
  it("целые тенге с неразрывными пробелами", () => {
    expect(text(<Money tiyn={122400000n} />)).toBe(`1${NB}224${NB}000${NB}₸`);
    expect(text(<Money tiyn={0n} />)).toBe(`0${NB}₸`);
    // Обычная сумма — одной строкой текста, знак полного размера.
    expect(html(<Money tiyn={122400000n} />)).toContain(`1${NB}224${NB}000${NB}₸`);
    // Крупная: текст тот же, знак — 0,6 размера и muted.
    expect(text(<Money tiyn={122400000n} large />)).toBe(`1${NB}224${NB}000${NB}₸`);
    const large = html(<Money tiyn={122400000n} large />);
    expect(/<span data-currency="true" class="([^"]*)">₸<\/span>/.exec(large)?.[1].split(" ")).toEqual(["text-currency", "text-muted"]);
    expect(/data-currency="true" class="([^"]*)"/.exec(html(<Money tiyn={1n} large tone="inherit" />))?.[1]).toBe("text-currency");
    expect(text(<Money tiyn={99900n} />)).toBe(`999${NB}₸`);
  });

  it("дробная часть только когда тиыны не кратны 100", () => {
    expect(text(<Money tiyn={122400050n} />)).toBe(`1${NB}224${NB}000,50${NB}₸`);
    expect(text(<Money tiyn={5n} />)).toBe(`0,05${NB}₸`);
    expect(text(<Money tiyn={50n} />)).toBe(`0,50${NB}₸`);
  });

  it("отрицательная сумма — с минусом U+2212", () => {
    expect(text(<Money tiyn={-150000n} />)).toBe(`−1${NB}500${NB}₸`);
    expect(text(<Money tiyn={-150050n} />)).toBe(`−1${NB}500,50${NB}₸`);
  });

  it("крупная сумма не теряет точности", () => {
    expect(text(<Money tiyn={123456789012345678900n} />)).toBe(`1${NB}234${NB}567${NB}890${NB}123${NB}456${NB}789${NB}₸`);
  });

  it("цифры табличные, строка не переносится", () => {
    const out = html(<Money tiyn={100n} />);
    expect(out).toContain("tabular-nums");
    expect(out).toContain("whitespace-nowrap");
  });

  it("сумма — цвет ink, в том числе значением строки списка; tone=inherit берёт цвет окружения", () => {
    expect(hasClass(html(<Money tiyn={100n} />), "text-ink")).toBe(true);
    expect(hasClass(html(<Money tiyn={100n} tone="inherit" />), "text-ink")).toBe(false);
    const row = html(
      <List>
        <ListRow label="К оплате" value={<Money tiyn={100n} />} />
      </List>,
    );
    const money = row.match(/<span[^>]*tabular-nums[^>]*>/)?.[0] ?? "";
    expect(hasClass(money, "text-ink")).toBe(true);
  });
});

describe("BackLink", () => {
  it("шеврон, название родителя, 15 px, цвет muted; диктор слышит «Назад»", () => {
    const out = html(<BackLink href="/v2/deals" label="Сделки" />);
    const a = out.match(/<a [^>]*>/)?.[0] ?? "";
    expect(a).toContain('href="/v2/deals"');
    for (const cls of ["text-sub", "text-muted"]) expect(hasClass(a, cls), cls).toBe(true);
    expect(a).not.toMatch(/text-accent|text-body/);
    expect(out).toContain("lucide-chevron-left");
    expect(text(<BackLink href="/v2/deals" label="Сделки" />)).toBe("Назад: Сделки");
    expect(out).toMatch(/<span class="sr-only">Назад: <\/span>/);
  });

  it("цель касания: база 48 px, на компьютере 36 px вариантом desktop:", () => {
    const a = html(<BackLink href="/v2/deals" label="Сделки" />).match(/<a [^>]*>/)?.[0] ?? "";
    expect(hasClass(a, "min-h-control")).toBe(true);
    expect(hasClass(a, "desktop:min-h-control-sm")).toBe(true);
    expect(hasClass(a, "min-h-control-sm")).toBe(false);
  });
});

describe("PageTitle", () => {
  it("один h1 и видимая ссылка «назад» — BackLink", () => {
    const back = { href: "/v2/deals", label: "Сделки" };
    const out = html(<PageTitle title="Сделка" back={back} />);
    expect(out).toMatch(/<a[^>]+href="\/v2\/deals"/);
    expect(out.match(/<h1/g)?.length).toBe(1);
    expect(text(<PageTitle title="Сделка" back={back} />)).toContain("Сделки");
    expect(out).toContain(html(<BackLink {...back} />));
  });

  it("без back ссылки нет; lead показывается", () => {
    const out = html(<PageTitle title="Сделка" lead={<span>Пояснение</span>} />);
    expect(out).not.toContain("<a");
    expect(out).toContain("Пояснение");
  });
});

describe("Progress", () => {
  it("role=progressbar с aria-valuenow, aria-valuemax и текстом «2 из 3»", () => {
    const out = html(<Progress value={2} max={3} label="Шаги" />);
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="2"');
    expect(out).toContain('aria-valuemax="3"');
    expect(out).toContain('aria-label="Шаги"');
    expect(out).toContain('aria-valuetext="2 из 3"');
  });

  it("value=0 — пустой трек: aria-valuenow 0 и текст «0 из 3»", () => {
    const out = html(<Progress value={0} max={3} label="Шаги" />);
    expect(out).toContain('aria-valuenow="0"');
    expect(out).toContain('aria-valuetext="0 из 3"');
    expect(out).toContain("scaleX(0)");
  });

  it("значение зажимается в [0, max]", () => {
    const over = html(<Progress value={9} max={3} label="Шаги" />);
    expect(over).toContain('aria-valuenow="3"');
    expect(over).toContain('aria-valuetext="3 из 3"');
    expect(html(<Progress value={-1} max={3} label="Шаги" />)).toContain('aria-valuenow="0"');
  });

  it("max <= 0 и не-числа — ничего не рисуется", () => {
    expect(html(<Progress value={1} max={0} label="Шаги" />)).toBe("");
    expect(html(<Progress value={1} max={-2} label="Шаги" />)).toBe("");
    expect(html(<Progress value={Number.NaN} max={3} label="Шаги" />)).toBe("");
    expect(html(<Progress value={1} max={Number.POSITIVE_INFINITY} label="Шаги" />)).toBe("");
  });

  it("segmented: деления по шагам, пройденные залиты, у текущего — начальная заливка; шаг 1 из 5 не пустой", () => {
    const first = html(<Progress value={0} max={5} label="Ход сделки" segmented />);
    expect(first).toContain('role="progressbar"');
    expect(first).toContain('aria-valuetext="0 из 5"');
    expect(first.match(/rounded-full bg-line/g)).toHaveLength(5);
    expect(first.match(/data-current-step/g)).toHaveLength(1);
    const second = html(<Progress value={2} max={5} label="Ход сделки" segmented />);
    expect(second.match(/w-full bg-accent/g)).toHaveLength(2);
    expect(second.match(/data-current-step/g)).toHaveLength(1);
    // Всё пройдено — текущего деления нет.
    expect(html(<Progress value={5} max={5} label="Ход сделки" segmented />)).not.toContain("data-current-step");
  });

  it("толщина полосы — 4 px (h-progress)", () => {
    const bar = html(<Progress value={1} max={2} label="Шаги" />).match(/<div[^>]*role="progressbar"[^>]*>/)?.[0] ?? "";
    expect(hasClass(bar, "h-progress")).toBe(true);
    expect(bar).not.toMatch(/\sh-\d|"h-\d/);
  });

  it("заливка прямоугольная: масштаб по X внутри скруглённого трека", () => {
    const out = html(<Progress value={1} max={2} label="Шаги" />);
    expect(out).toContain("scaleX(0.5)");
    expect(out).toContain("overflow-hidden");
    const fill = /<div[^>]*origin-left[^>]*>/.exec(out)?.[0] ?? "";
    expect(fill).not.toContain("rounded");
  });
});

describe("Остальное", () => {
  it("PhotoSlot без src — заглушка без картинки, с src — ленивая картинка с alt", () => {
    expect(html(<PhotoSlot alt="Кухня" ratio="4/3" />)).not.toContain("<img");
    const out = html(<PhotoSlot alt="Кухня" ratio="1/1" src="/p.jpg" />);
    expect(out).toContain("<img");
    expect(out).toContain('alt="Кухня"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
  });

  it("Skeleton: заданное число строк, строки скрыты от диктора, диктор слышит «Загрузка»", () => {
    const out = html(<Skeleton lines={4} />);
    const lines = out.match(/<div[^>]*data-skeleton-line[^>]*>/g) ?? [];
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(line).toContain('aria-hidden="true"');
    expect(out).toContain('role="status"');
    expect(text(<Skeleton lines={4} />)).toBe("Загрузка");
  });

  it("Card и StatusChip", () => {
    expect(html(<Card as="section">x</Card>)).toMatch(/^<section/);
    expect(html(<StatusChip tone="accent">В пути</StatusChip>)).toContain("В пути");
  });

  it("StatusChip: 28 / 26 px в строку, текст 15 px / 500, точка 8 px слева у первой строки (скрыта от диктора)", () => {
    const out = html(<StatusChip tone="accent">В пути</StatusChip>);
    const chip = /<span[^>]*data-status-chip[^>]*>/.exec(out)?.[0] ?? "";
    for (const cls of ["text-sub", "font-medium", "py-chip-y", "desktop:py-chip-y-desktop", "px-chip-x"]) expect(hasClass(chip, cls), cls).toBe(true);
    expect(hasClass(chip, "text-small")).toBe(false);
    const dotRow = /<span aria-hidden="true"[^>]*>/.exec(out)?.[0] ?? "";
    for (const cls of ["h-lh", "shrink-0", "items-center"]) expect(hasClass(dotRow, cls), cls).toBe(true);
    const dot = out.slice(out.indexOf(dotRow) + dotRow.length).match(/^<span[^>]*>/)?.[0] ?? "";
    for (const cls of ["size-2", "rounded-full", "bg-accent"]) expect(hasClass(dot, cls), cls).toBe(true);
    expect(text(<StatusChip tone="accent">В пути</StatusChip>)).toBe("В пути");
  });

  it("StatusChip при переносе (крупный шрифт) — не «облако»: не шире строки, радиус 14 px и поля 12 px в px, подпись переносится по словам", () => {
    const out = html(<StatusChip tone="neutral">Мастер делает мебель</StatusChip>);
    const chip = /<span[^>]*data-status-chip[^>]*>/.exec(out)?.[0] ?? "";
    for (const cls of ["max-w-full", "rounded-status", "items-start"]) expect(hasClass(chip, cls), cls).toBe(true);
    for (const cls of ["rounded-chip", "rounded-full", "whitespace-nowrap"]) expect(hasClass(chip, cls), cls).toBe(false);
    expect(out).toContain('<span class="min-w-0">Мастер делает мебель</span>');
    const tokens = readFileSync(path.join(__dirname, "tokens.css"), "utf8");
    expect(tokens).toMatch(/--radius-status: 14px;/);
    expect(tokens).toMatch(/--spacing-chip-x: 12px;/);
    expect(tokens).toMatch(/--spacing-chip-y: calc\(\(1\.75rem - 1lh\) \/ 2\);/);
  });

  it.each([
    ["neutral", "bg-fill", "text-ink", "bg-muted"],
    ["warn", "bg-warn-soft", "text-warn", "bg-warn"],
    ["accent", "bg-accent-soft", "text-accent", "bg-accent"],
    ["danger", "bg-danger-soft", "text-danger", "bg-danger"],
  ] as const)("StatusChip %s: заливка %s, текст %s, точка %s", (tone, fill, ink, dot) => {
    const out = html(<StatusChip tone={tone}>Статус</StatusChip>);
    for (const cls of [fill, ink, dot]) expect(hasClass(out, cls), cls).toBe(true);
    expect(hasClass(out, "bg-line")).toBe(false);
  });

  it("List: разделители с отступом 16 px слева, у последней строки разделителя нет", () => {
    const out = html(
      <List>
        <ListRow label="Срок" value="3 дня" />
        <ListRow label="Адрес" value="—" />
      </List>,
    );
    expect(out).not.toContain("divide-y");
    const items = out.match(/<li[^>]*>/g) ?? [];
    expect(items).toHaveLength(2);
    for (const li of items) {
      for (const cls of ["relative", "after:absolute", "after:left-card", "after:right-0", "after:bottom-0", "after:border-b", "after:border-line", "last:after:hidden"]) {
        expect(hasClass(li, cls), cls).toBe(true);
      }
    }
  });

  it("ListRow с action: в <li> форма с кнопкой отправки и скрытыми полями; вид и разделитель как у строки-ссылки", () => {
    const out = html(
      <List>
        <ListRow label="Новое предложение" action={async () => {}} fields={{ id: "n1" }} />
      </List>,
    );
    expect(out).toMatch(/<li[^>]*><form/);
    expect(out).toMatch(/<button[^>]+type="submit"/);
    expect(out).toContain('<input type="hidden" name="id" value="n1"/>');
    expect(out).not.toContain("<a ");
    const button = out.match(/<button[^>]*>/)?.[0] ?? "";
    for (const cls of ["min-h-control", "w-full", "px-card", "py-3", "text-left", "hover:bg-canvas"]) expect(hasClass(button, cls), cls).toBe(true);
    expect(out).not.toContain("lucide-chevron-right");
  });

  it("ListRow при крупном шрифте: поля 16 px в px; значение переносится целиком на строку ниже, строка с одним шевроном — нет", () => {
    const out = html(
      <List>
        <ListRow label="Телефон" value="+7 700 000 02 01" href="/v2/x" />
        <ListRow label="Где мои деньги?" href="/v2/help" />
      </List>,
    );
    const [withValue, onlyChevron] = out.match(/<a [^>]*>/g) ?? [];
    for (const cls of ["px-card", "flex-wrap", "gap-y-1"]) expect(hasClass(withValue ?? "", cls), cls).toBe(true);
    expect(out).toMatch(/<span class="ml-auto flex shrink-0 items-center gap-1 text-ink"><span>\+7 700 000 02 01<\/span>/);
    expect(hasClass(onlyChevron ?? "", "flex-wrap")).toBe(false);
    expect(hasClass(onlyChevron ?? "", "px-card")).toBe(true);
  });

  it("List: строки, ссылка со своим hover-фоном", () => {
    const out = html(
      <List>
        <ListRow label="Срок" value="3 дня" />
        <ListRow label="Адрес" href="/v2/address" />
      </List>,
    );
    expect(out.match(/<li/g)?.length).toBe(2);
    expect(out).toMatch(/<a[^>]+href="\/v2\/address"/);
    expect(out).toContain("hover:bg-canvas");
    expect(out).toContain("active:bg-fill-strong");
    expect(hasClass(out, "pressable")).toBe(false);
    expect(out).toContain("3 дня");
  });
});

describe("PageTitle: перенос строк", () => {
  it("h1 с text-balance: нет висящих слов", () => {
    expect(html(<PageTitle title="Деньги в банке" />)).toMatch(/<h1 class="(?:[^"]*\s)?text-balance(?:\s[^"]*)?"/);
  });

  it("trailing — в строке h1 справа; при нехватке места уходит под заголовок (flex-wrap), слово не рвётся (без min-w-0)", () => {
    const out = html(<PageTitle title="Кухня" back={{ href: "/v2/deals", label: "Сделки" }} trailing={<span>КНОПКА</span>} />);
    const row = out.slice(out.lastIndexOf("<div", out.indexOf("<h1")), out.indexOf("КНОПКА"));
    expect(row).toContain("flex-wrap");
    expect(out.indexOf("КНОПКА")).toBeGreaterThan(out.indexOf("</h1>"));
    expect(out.indexOf("КНОПКА")).toBeLessThan(out.indexOf("</header>"));
    const h1 = (out.match(/<h1 class="([^"]*)"/)?.[1] ?? "").split(" ");
    expect(h1).toContain("max-w-full");
    expect(h1).not.toContain("min-w-0");
  });
});
