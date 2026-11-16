import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { DataTable, KeyValueList, Money, QueueCard, type DataTableColumn } from "@/kit";
import { count, hasClass, html } from "@/kit/test-utils";
import { nextQueueFocus } from "./queue-logic";

type Row = { id: string; title: string; status: string; tiyn: bigint };

const ROWS: Row[] = [
  { id: "41", title: "Сделка №41 · Кухня", status: "Деньги в банке", tiyn: 154_000_000n },
  { id: "38", title: "Сделка №38 · Шкаф", status: "В работе", tiyn: 48_000_000n },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "title", header: "Сделка", cell: (row) => row.title, rowHeader: true, width: "wide" },
  { key: "status", header: "Статус", cell: (row) => row.status, width: "narrow" },
  { key: "price", header: "Цена", cell: (row) => <Money tiyn={row.tiyn} />, numeric: true },
];

const EMPTY = { title: "Сделок пока нет", body: "Сделка появится после оферты." };

const table = (over: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
  html(<DataTable caption="Сделки" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} empty={EMPTY} {...over} />);

describe("DataTable", () => {
  it("область прокрутки — именованный регион с tabIndex=0, прокрутка вбок внутри, а не у страницы", () => {
    const out = table();
    expect(out).toContain('role="region"');
    expect(out).toContain(`aria-label="${ru.app.kit.table.region("Сделки")}"`);
    expect(out).toContain('tabindex="0"');
    const region = out.match(/<div role="region"[^>]*>/)?.[0] ?? "";
    expect(hasClass(region, "overflow-x-auto")).toBe(true);
    expect(hasClass(region, "min-w-0")).toBe(true);
    expect(hasClass(region, "max-w-full")).toBe(true);
  });

  it("подпись, заголовки столбцов scope=col и заголовок строки scope=row", () => {
    const out = table();
    expect(out).toMatch(/<caption[^>]*>Сделки<\/caption>/);
    expect(count(out, 'scope="col"')).toBe(3);
    expect(count(out, 'scope="row"')).toBe(2);
    expect(out).toMatch(/<th scope="row"[^>]*>Сделка №41 · Кухня<\/th>/);
  });

  it("числа и суммы — справа табличными цифрами без переноса; длинный столбец не уже доли окна", () => {
    const out = table();
    const price = [...out.matchAll(/<td class="[^"]*">(?:(?!<\/td>).)*<\/td>/g)].map((m) => m[0]).find((cell) => cell.includes("₸")) ?? "";
    expect(hasClass(price, "text-right")).toBe(true);
    expect(hasClass(price, "tabular-nums")).toBe(true);
    expect(hasClass(price, "whitespace-nowrap")).toBe(true);
    expect(out).toContain("min-w-col-wide");
    expect(out).toContain("min-w-col-narrow");
  });

  it("подпись только для диктора — sr-only, имя региона то же", () => {
    const out = table({ captionHidden: true });
    expect(out).toMatch(/<caption class="sr-only">Сделки<\/caption>/);
    expect(out).toContain(`aria-label="${ru.app.kit.table.region("Сделки")}"`);
  });

  it("строка итога — в tfoot по ключам столбцов, пустые ячейки на месте", () => {
    const out = table({ footer: { title: "Итого", price: <Money tiyn={202_000_000n} /> } });
    const foot = out.match(/<tfoot>.*<\/tfoot>/)?.[0] ?? "";
    expect(foot).toMatch(/<th scope="row"[^>]*>Итого<\/th>/);
    expect(count(foot, "<td")).toBe(2);
    expect(foot).toContain("2");
  });

  it("строк нет — обучающий пустой экран вместо пустой сетки", () => {
    const out = table({ rows: [] });
    expect(out).not.toContain("<table");
    expect(out).not.toContain('role="region"');
    expect(out).toContain(EMPTY.title);
    expect(out).toContain(EMPTY.body);
  });
});

describe("KeyValueList", () => {
  it("разметка dl: подпись — dt, значение — dd; на компьютере две колонки, на телефоне подпись над значением", () => {
    const out = html(
      <KeyValueList
        items={[
          { label: "Исполнитель", value: "ИП «Арман»" },
          { label: "Сумма", value: <Money tiyn={1_000_00n} /> },
        ]}
      />,
    );
    expect(out.startsWith("<dl")).toBe(true);
    expect(count(out, "<dt")).toBe(2);
    expect(count(out, "<dd")).toBe(2);
    expect(out).toMatch(/<dt[^>]*>Исполнитель<\/dt><dd[^>]*>ИП «Арман»<\/dd>/);
    expect(out).toContain("desktop:grid-cols-key-value");
    expect(out).toContain("first:border-t-0");
  });
});

describe("очередь решений: куда перевести фокус после решения", () => {
  it("карточка ушла — фокус на ту, что встала на её место", () => {
    expect(nextQueueFocus(0, 2)).toBe(0);
    expect(nextQueueFocus(1, 3)).toBe(1);
  });

  it("решена последняя карточка — фокус на новую последнюю", () => {
    expect(nextQueueFocus(2, 2)).toBe(1);
  });

  it("очередь опустела — некуда (фокус на заголовок пустого состояния)", () => {
    expect(nextQueueFocus(0, 0)).toBeNull();
  });

  it("место карточки неизвестно — на первую", () => {
    expect(nextQueueFocus(-1, 3)).toBe(0);
  });

  it("карточка очереди — <li> с заголовком-целью фокуса (tabIndex=-1)", () => {
    const out = html(
      <QueueCard title="Операция по сделке №41" meta="1 540 000 ₸">
        <p>форма</p>
      </QueueCard>,
    );
    expect(out.startsWith("<li")).toBe(true);
    expect(out).toMatch(/<h2 tabindex="-1"[^>]*>Операция по сделке №41<\/h2>/);
    expect(html(<QueueCard title="Внутри раздела" headingLevel={3} />)).toMatch(/<h3 tabindex="-1"/);
  });
});
