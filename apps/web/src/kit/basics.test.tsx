import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
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
  Select,
  Skeleton,
  StatusChip,
  TextArea,
  TextField,
} from "./index";

const html = (el: ReactElement): string => renderToStaticMarkup(el);
const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };
const text = (el: ReactElement): string =>
  html(el)
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#x27);/g, (m) => ENTITIES[m] ?? m);

const NB = " ";
const describedByPair = /aria-describedby="([^"]+)"[\s\S]*id="\1"|id="([^"]+)"[\s\S]*aria-describedby="\2"/;

describe("Button", () => {
  it("primary по умолчанию ставит data-primary-action, остальные варианты нет", () => {
    expect(html(<Button>Ок</Button>)).toContain("data-primary-action");
    expect(html(<Button variant="secondary">Ок</Button>)).not.toContain("data-primary-action");
    expect(html(<Button variant="quiet">Ок</Button>)).not.toContain("data-primary-action");
    expect(html(<Button variant="danger">Ок</Button>)).not.toContain("data-primary-action");
  });

  it("pending блокирует повторное нажатие и показывает индикатор", () => {
    const out = html(<Button pending>Ок</Button>);
    expect(out).toMatch(/disabled|aria-disabled="true"/);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("<svg");
  });

  it("по умолчанию type=button; размеры md и sm различаются", () => {
    expect(html(<Button>Ок</Button>)).toContain('type="button"');
    expect(html(<Button size="sm">Ок</Button>)).toContain("min-h-control-sm");
    expect(html(<Button>Ок</Button>)).toContain("min-h-control");
  });

  it("full растягивает кнопку", () => {
    expect(html(<Button full>Ок</Button>)).toContain("w-full");
  });

  it("ButtonLink — ссылка с теми же метками", () => {
    const out = html(<ButtonLink href="/v2/deals">Сделки</ButtonLink>);
    expect(out).toMatch(/<a[^>]+href="\/v2\/deals"/);
    expect(out).toContain("data-primary-action");
    expect(html(<ButtonLink href="/x" variant="quiet">Ок</ButtonLink>)).not.toContain("data-primary-action");
  });
});

describe("Поля", () => {
  it("ошибка связана с полем и помечает его невалидным", () => {
    const f = html(<TextField label="Почта" name="email" error="Проверьте адрес" />);
    expect(f).toContain('aria-invalid="true"');
    expect(f).toMatch(describedByPair);
    expect(f).toContain("Проверьте адрес");
  });

  it("без ошибки нет aria-invalid и aria-describedby", () => {
    const f = html(<TextField label="Почта" name="email" />);
    expect(f).not.toContain("aria-invalid");
    expect(f).not.toContain("aria-describedby");
    expect(f).toContain('name="email"');
  });

  it("подпись привязана к полю", () => {
    const f = html(<TextField label="Почта" name="email" />);
    expect(f).toMatch(/<label[^>]+for="([^"]+)"[\s\S]*<input[^>]+id="\1"/);
  });

  it("TextArea, Select, Checkbox и RadioCard тоже связывают ошибку", () => {
    expect(html(<TextArea label="Описание" name="d" error="Коротко" />)).toMatch(describedByPair);
    expect(
      html(
        <Select label="Город" name="c" error="Выберите">
          <option value="a">Астана</option>
        </Select>,
      ),
    ).toMatch(describedByPair);
    expect(html(<Checkbox label="Согласен" name="ok" error="Нужно согласие" />)).toMatch(describedByPair);
    expect(html(<RadioCard label="Самовывоз" name="m" value="a" error="Выберите способ" />)).toMatch(describedByPair);
    expect(html(<Checkbox label="Согласен" name="ok" error="Нужно" />)).toContain('aria-invalid="true"');
  });

  it("RadioCard — радиокнопка внутри подписи", () => {
    const out = html(<RadioCard label="Самовывоз" name="m" value="a" />);
    expect(out).toContain('type="radio"');
    expect(out).toContain("Самовывоз");
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
  });

  it("отрицательная сумма — с минусом U+2212", () => {
    expect(text(<Money tiyn={-150000n} />)).toBe(`−1${NB}500${NB}₸`);
  });

  it("цифры табличные, строка не переносится", () => {
    const out = html(<Money tiyn={100n} />);
    expect(out).toContain("tabular-nums");
    expect(out).toContain("whitespace-nowrap");
  });
});

describe("PageTitle", () => {
  it("один h1 и видимая ссылка «назад»", () => {
    const out = html(<PageTitle title="Сделка" back={{ href: "/v2/deals", label: "Сделки" }} />);
    expect(out).toMatch(/<a[^>]+href="\/v2\/deals"/);
    expect(out.match(/<h1/g)?.length).toBe(1);
    expect(text(<PageTitle title="Сделка" back={{ href: "/v2/deals", label: "Сделки" }} />)).toContain("Сделки");
  });

  it("без back ссылки нет; lead показывается", () => {
    const out = html(<PageTitle title="Сделка" lead={<span>Пояснение</span>} />);
    expect(out).not.toContain("<a");
    expect(out).toContain("Пояснение");
  });
});

describe("Остальное", () => {
  it("Progress — role=progressbar с aria-valuenow и aria-valuemax", () => {
    const out = html(<Progress value={2} max={3} label="Шаги" />);
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="2"');
    expect(out).toContain('aria-valuemax="3"');
    expect(out).toContain('aria-label="Шаги"');
  });

  it("Progress не выходит за границы", () => {
    expect(html(<Progress value={9} max={3} label="Шаги" />)).toContain('aria-valuenow="3"');
    expect(html(<Progress value={-1} max={3} label="Шаги" />)).toContain('aria-valuenow="0"');
  });

  it("PhotoSlot без src — заглушка без картинки, с src — картинка с alt", () => {
    expect(html(<PhotoSlot alt="Кухня" ratio="4/3" />)).not.toContain("<img");
    const out = html(<PhotoSlot alt="Кухня" ratio="1/1" src="/p.jpg" />);
    expect(out).toContain("<img");
    expect(out).toContain('alt="Кухня"');
  });

  it("Skeleton рисует заданное число строк и скрыт от диктора", () => {
    const out = html(<Skeleton lines={4} />);
    expect(out.match(/data-skeleton-line/g)?.length).toBe(4);
    expect(out).toContain('role="status"');
  });

  it("Card, StatusChip, List", () => {
    expect(html(<Card as="section">x</Card>)).toMatch(/^<section/);
    expect(html(<StatusChip tone="accent">В пути</StatusChip>)).toContain("В пути");
    const out = html(
      <List>
        <ListRow label="Срок" value="3 дня" />
        <ListRow label="Адрес" href="/v2/address" />
      </List>,
    );
    expect(out.match(/<li/g)?.length).toBe(2);
    expect(out).toMatch(/<a[^>]+href="\/v2\/address"/);
    expect(out).toContain("3 дня");
  });
});
