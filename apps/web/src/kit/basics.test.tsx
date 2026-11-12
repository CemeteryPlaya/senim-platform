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
    expect(busy).not.toContain("scale-press");
    const idle = html(<Button>Ок</Button>);
    expect(hasClass(idle, "hover:not-disabled:opacity-90")).toBe(true);
    expect(hasClass(idle, "active:not-disabled:scale-press")).toBe(true);
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
    "%s: отключённая — подложка line, текст muted, без прозрачности (одинаково у всех вариантов)",
    (variant) => {
      const out = html(<Button variant={variant} disabled>Ок</Button>);
      for (const cls of ["disabled:bg-line", "disabled:text-muted"]) expect(hasClass(out, cls), cls).toBe(true);
      const tag = out.match(/<button[^>]*>/)?.[0] ?? "";
      expect(tag).not.toMatch(/[\s"](?:disabled:)?opacity-\d/);
    },
  );

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

  it("StatusChip: 13 px / 600, отступы 4 × 8 px, радиус 6 px, как .chip в эталоне", () => {
    const chip = html(<StatusChip tone="accent">В пути</StatusChip>);
    for (const cls of ["text-small", "font-semibold", "px-2", "py-1", "rounded-chip"]) expect(hasClass(chip, cls), cls).toBe(true);
    expect(hasClass(chip, "text-sub")).toBe(false);
  });

  it("StatusChip neutral: подложка line, текст ink (muted на line ниже 4,5:1)", () => {
    const chip = html(<StatusChip tone="neutral">Черновик</StatusChip>);
    expect(hasClass(chip, "bg-line")).toBe(true);
    expect(hasClass(chip, "text-ink")).toBe(true);
    expect(hasClass(chip, "bg-canvas")).toBe(false);
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
      for (const cls of ["relative", "after:absolute", "after:left-4", "after:right-0", "after:bottom-0", "after:border-b", "after:border-line", "last:after:hidden"]) {
        expect(hasClass(li, cls), cls).toBe(true);
      }
    }
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
    expect(out).toContain("active:bg-line");
    expect(out).not.toContain("scale-press");
    expect(out).toContain("3 дня");
  });
});
