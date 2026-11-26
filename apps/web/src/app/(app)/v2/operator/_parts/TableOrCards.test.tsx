import { describe, expect, it } from "vitest";
import { count, html } from "@/kit/test-utils";
import { TableOrCards } from "./TableOrCards";

type Row = { key: string; label: string; count: number; created: string };

const ROWS: Row[] = [
  { key: "a", label: "Черновик", count: 2, created: "1 ноября" },
  { key: "b", label: "Опубликована", count: 5, created: "2 ноября" },
];

const COLUMNS = [
  { key: "label", header: "Статус", rowHeader: true, cell: (r: Row) => r.label },
  { key: "count", header: "Количество", numeric: true, cell: (r: Row) => r.count },
  { key: "created", header: "Создана", cell: (r: Row) => r.created },
];

const render = (props: { compact?: boolean; phoneKeys?: readonly string[] } = {}) =>
  html(<TableOrCards caption="Заявки" captionHidden rows={ROWS} rowKey={(r) => r.key} empty={{ title: "Пусто", body: "Нет записей" }} columns={COLUMNS} footer={{ label: "Всего", count: 7 }} {...props} />);

/** Разметка телефона: всё после таблицы компьютера. */
const phone = (out: string) => out.slice(out.indexOf("</table>"));

describe("TableOrCards: телефон", () => {
  it("по умолчанию — карточка на строку, подписи у значений в строку (KeyValueList inline)", () => {
    const out = phone(render());
    expect(count(out, "<dl")).toBe(3);
    expect(out).toContain("flex-row flex-wrap items-baseline");
    expect(out).toContain(">Количество</dt>");
  });

  it("compact — одна карточка со строками «статус — 4», подписи столбцов только для диктора, итог последней строкой", () => {
    const out = phone(render({ compact: true }));
    expect(out).not.toContain("<dl");
    expect(count(out, "<li")).toBe(3);
    expect(out).toContain('<span class="sr-only">Количество: </span>2');
    expect(out).toMatch(/border-line-strong font-semibold[^>]*><span[^>]*>Всего<\/span>/);
  });

  it("phoneKeys — на телефоне только перечисленные столбцы; на компьютере — все", () => {
    const out = render({ phoneKeys: ["count"] });
    expect(phone(out)).not.toContain("Создана");
    expect(out.slice(0, out.indexOf("</table>"))).toContain("Создана");
  });
});
